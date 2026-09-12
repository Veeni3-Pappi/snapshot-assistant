# MSMS — production-oriented bulk SMS (contacts → queue → send)

MSMS is a Kotlin Android application that (with explicit user consent and runtime permissions) reads locally synchronized phone numbers from the Android Contacts Provider, lets the user compose one message, optionally exclude recipients, and sends SMS sequentially with throttling. Sending runs in a **foreground service** so Android’s background execution limits are less likely to terminate an in‑progress queue.

> **Responsible use:** Automated or bulk SMS can violate carrier terms, local regulations, or anti‑spam laws. This project is engineered for **device-owner initiated** messaging where you control content and recipients. You are responsible for compliance.

---

## High-level architecture

| Layer | Responsibility |
|------|------------------|
| **UI (Jetpack Compose + Material 3)** | Dashboard (composer, counters, SIM selection, progress, logs), recipient preview (search + exclusions), runtime permission UX. |
| **ViewModel (`MainViewModel`, Hilt)** | Owns user-edited state (message, SIM selection, exclusions), loads contacts/SIM metadata via repositories, hands recipient payloads to the service, mirrors engine UI state from the bound foreground service. |
| **Repositories** | `ContactRepository` queries `ContactsContract.CommonDataKinds.Phone` on a background dispatcher. `SimRepository` reads active subscriptions via `SubscriptionManager`. |
| **Foreground `SmsService`** | Reads the queued recipient list from a **cache file** (avoids huge Binder transactions), walks recipients sequentially with `delay`, sends with subscription-bound `SmsManager`, aggregates multipart **sent/delivery** callbacks, updates `StateFlow` UI snapshots, and shows a **persistent notification** (with a Stop action). |
| **`SmsStatusReceiver` (explicit broadcasts)** | Receives `PendingIntent` results for each SMS part; forwards structured events to `SmsCallbackHub` so the service can append logs and update per-recipient aggregates safely. |

The codebase uses **Hilt** for constructor injection, **Coroutines** for IO + structured concurrency, and **`StateFlow`** for lifecycle-friendly reactive state.

---

## Permissions (runtime) and graceful degradation

Runtime permissions requested (see `DashboardScreen` disclosure card + system dialog):

- **`READ_CONTACTS`**: required to enumerate numbers + display names.
- **`SEND_SMS`**: required to transmit SMS PDUs.
- **`READ_PHONE_STATE`**: used to read active SIM / subscription metadata (dual SIM routing). On many devices this is also the practical gate for reliable subscription listing.
- **`POST_NOTIFICATIONS` (Android 13 / API 33+)**: required to show the foreground-service notification while sending.
- **`ACCESS_NETWORK_STATE`**: used for lightweight connectivity hints (SMS is CS-domain oriented; this is informational, not a guarantee of SMS success).

If permissions are denied, MSMS avoids crashing: contacts/SIM lists may remain empty, controls stay disabled, and the user can open **App settings** from the dialog. On returning to the app, an `ON_START` observer reloads data when permissions become granted.

---

## Contact extraction, normalization, and deduplication

`ContactRepository` queries `ContactsContract.CommonDataKinds.Phone.CONTENT_URI` with a minimal projection and walks the cursor on `Dispatchers.IO`, periodically calling `ensureActive()` so extremely large databases are less likely to pin the worker forever.

For each row:

1. **Normalize** by stripping visual formatting characters and common dial-string separators (spaces, `()-`, pauses), preserving a leading `+` when present.
2. **Validate** using E.164-ish digit length heuristics (7–15 digits after removing `+`).
3. **De-duplicate** using a `HashSet` of normalized numbers so the same MSISDN is not queued twice even if multiple raw rows exist.

Each `Contact` uses a stable synthetic `id` for Compose list keys.

---

## Dual SIM / eSIM / multi-subscription behavior

`SimRepository` reads `SubscriptionManager.activeSubscriptionInfoList` and maps each `SubscriptionInfo` to `SimInfo` (subscription id, slot index, display label, carrier name, line number when exposed by the OS).

The user selects a subscription on the dashboard. Sending uses:

```kotlin
SmsManager.getSystemService(...).createForSubscriptionId(subscriptionId) // API 31+
```

(or the pre-31 compatibility API) so PDUs are associated with the intended subscription where OEM telephony stacks honor it. Real-world dual SIM routing can still vary by manufacturer; MSMS logs SIM state warnings (see `TelephonyPreconditions`) but cannot override OEM policy.

---

## SMS sending engine (queue, throttling, multipart, callbacks)

### Queue + delay

The engine sends **one recipient at a time** and `delay(delayMs)` between recipients (slider presets or custom seconds). This reduces the risk of radio queue saturation, OEM rate limits, and ANRs compared with “fan-out” sends.

### Foreground execution

`startForegroundService` + `startForeground` with `foregroundServiceType="specialUse"` keeps the process eligible to continue while the user switches apps or the screen rotates. Android 14+ expects a declared special-use justification (`PROPERTY_SPECIAL_USE_CATEGORY` in the manifest).

### Multipart + per-part `PendingIntent`s

Long bodies are split with `SmsManager.divideMessage` and sent via `sendMultipartTextMessage`. Each part receives unique `PendingIntent` request codes to avoid collisions.

### Sent vs failed accounting

`SmsStatusReceiver` emits `SmsCallbackEvent.SentPart` / `DeliveryPart` into `SmsCallbackHub`. The service:

- Logs every part with timestamps.
- Tracks per-phone failures for multipart messages.
- Increments **`sent` or `failed` once per recipient** when the final part’s sent callback arrives.

> **Delivery receipts** are best-effort. Many carriers never surface handset delivery acknowledgements to the sender app; absence of `DELIVERED` lines is normal.

### Pause / resume / stop

- **Pause** sets an atomic flag inspected between recipients.
- **Resume** clears the flag.
- **Stop** cancels the coroutine job and tears down foreground state (`STOP_FOREGROUND_DETACH`) then `stopSelf()`.

Control intents (`ACTION_PAUSE` / `ACTION_RESUME` / `ACTION_STOP`) allow the UI to operate even if the binder connection is momentarily unavailable.

---

## Passing large recipient lists safely

`MainViewModel.startSending` writes recipients to `cacheDir` JSON via `RecipientsFileStore` and passes only the **file path** in the service intent. This avoids Binder size limits when thousands of recipients are queued.

---

## UI notes (Compose vs `RecyclerView`)

Compose **`LazyColumn`** is used for logs and the recipient preview. It provides the same recycling behavior as `RecyclerView` for long lists while matching the rest of the Compose UI.

---

## Operational logging

Logs are modeled as `LogEntry` rows (monotonic `id` + text) capped in the service to prevent unbounded memory growth. The dashboard auto-scrolls to the newest line while still allowing manual scroll-back.

---

## Build

```bash
./gradlew :app:assembleDebug
```

Debug APK output: `app/build/outputs/apk/debug/`.

---

## Known limitations (honest engineering notes)

- **Carrier / OEM variance** can affect dual-SIM routing, delivery callbacks, and rate limits even when APIs are used correctly.
- **Android 10+ default SMS role** is *not* required for `sendTextMessage`/`sendMultipartTextMessage` in the classic sense, but some OEM builds gate UX; MSMS targets direct sends with `SEND_SMS`.
- **Cost / billing** (SMS bundles, RCS fallback, international rates) is user/carrier responsibility; MSMS does not estimate charges.
- **KAPT + Kotlin 2.0**: Gradle may warn that KAPT falls back to Kotlin 1.9 language mode for stub generation; this is a tooling warning, not a runtime behavior change.

---

## Module map (primary files)

- `MsmsApplication` / `di/AppModule` — Hilt wiring.
- `repository/ContactRepository.kt` — contacts IO + normalization.
- `repository/SimRepository.kt` — active subscriptions.
- `service/SmsService.kt` — foreground queue engine + UI state.
- `receiver/SmsStatusReceiver.kt` — SMS part callbacks.
- `sms/SmsCallbackHub.kt` — process-wide callback fan-in.
- `viewmodel/MainViewModel.kt` — UI orchestration + service binding.
- `ui/dashboard/DashboardScreen.kt` — primary UX surface.
- `ui/preview/ContactPreviewScreen.kt` — search + exclusions.

---

## Security & privacy posture (developer checklist)

- Do not log message bodies (PII + sensitive content). MSMS logs operational metadata (numbers/names/status).
- Avoid shipping this pattern to unmanaged fleets without enterprise policy controls.
- Consider adding an explicit in-app “typing confirmation” step for regulated environments.

---

## License

This repository is provided as sample engineering for learning and integration into environments you control. Ensure your deployment complies with applicable law and carrier agreements.
