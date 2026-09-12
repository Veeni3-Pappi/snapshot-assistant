# 📱 MSMS Android SMS Gateway Integration Guide

This guide explains how to use your Android phone running the **MSMS Gateway (smsgt)** app as a local SMS gateway for **Salon Snapshot**, sending automated daily summary SMS notifications directly through your phone's SIM bundle.

---

## 🏗️ How the System Works

```
┌──────────────────────────────────────┐                ┌──────────────────────────────────────┐
│        Salon Snapshot Server         │                │     Android Phone (MSMS App)         │
│  (Node.js / Express on Computer)     │                │   (Installed via Msms-Gateway.apk)   │
├──────────────────────────────────────┤                ├──────────────────────────────────────┤
│ 1. CCTV & Books Analyzed             │                │                                      │
│ 2. Generates SMS Summary             │                │                                      │
│ 3. Dispatches via SMS Gateway:       │                │                                      │
│    A. Direct Push (POST :8080/send) ───[Wi-Fi / LAN]───► Embedded HTTP Server                │
│       OR                             │                │      │                               │
│    B. Queues message (:3000/pending) ◄───[Polls 5s]──── Polling Worker                      │
│                                      │                │      ▼                               │
│ 4. Receives Delivery Callback ◄──────┼───[Status]────── Calls Android Telephony (SmsManager) │
└──────────────────────────────────────┘                │      │                               │
                                                        │      ▼                               │
                                                        │ 📡 Sends SMS to Recipient via SIM    │
                                                        └──────────────────────────────────────┘
```

---

## 🚀 Quick Setup (3 Steps)

### Step 1: Install the APK on your Android Phone
We have built and placed the ready-to-install APK in your project directory:
- 📁 **File:** [`Msms-Gateway.apk`](file:///home/casualace/Desktop/salon-snapshots_app/Msms-Gateway.apk) (9.9 MB)

**To install:**
1. Connect your phone via USB or send `Msms-Gateway.apk` to your phone (via WhatsApp, Telegram, Google Drive, or run `adb install Msms-Gateway.apk`).
2. On your phone, tap the file to install it.
3. Grant permissions when prompted (**SMS**, **Contacts**, **Phone State**, **Notifications**).

---

### Step 2: Start the Gateway in MSMS
1. Open the **MSMS** app on your phone.
2. Tap the **Gateway** tab in the bottom navigation bar.
3. Verify your computer's server URL:
   - Default: `http://192.168.0.108:3000` (or run `npm run ip` in your terminal to see your computer's current Wi-Fi IP).
4. Select your preferred SIM (SIM 1 or SIM 2).
5. Tap **Start**.
   - The status indicator turns **GREEN (ONLINE)**.
   - A persistent foreground notification appears to ensure Android does not kill the service in the background.

---

### Step 3: Verify & Send Reports
1. In your computer's terminal, start the server:
   ```bash
   npm start
   ```
2. Open **http://localhost:3000** in your browser.
3. Look at the new **SMS Gateway** status widget in the header:
   - It will show: `SMS Gateway: Phone Online (Device Model)`
4. Click **Test SMS** to send a test message to your phone.
5. When you upload CCTV snapshots and click **"Send PDF Report by Email"**, Salon Snapshot will simultaneously send the daily summary SMS directly through your phone!

---

## ⚙️ Configuration (`.env`)

In your `.env` file:

```env
# SMS Provider: 'msms' (Android Phone), 'africastalking', or 'auto' (MSMS first, Africa's Talking fallback)
SMS_PROVIDER=msms

# Direct Phone Push URL (Optional - if phone uses polling, this is automatically discovered!)
# SMS_GATEWAY_URL=http://192.168.0.xxx:8080

# SIM Slot to use (0 for SIM 1, 1 for SIM 2)
SMS_SIM_SLOT=0

# SMS Recipient Phone Number
SMS_RECIPIENT=+254713405976

# Notification Method (both = Email + SMS)
NOTIFICATION_METHOD=both
```

---

## 📡 REST API Endpoints

The backend in `server.js` and `smsGateway.js` provides the following endpoints:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/sms-gateway/status` | Current gateway status, queue length, and registered devices |
| `GET` | `/api/sms-gateway/pending` | Polled by Android phone to fetch pending SMS jobs |
| `POST` | `/api/sms-gateway/status` | Callback from Android phone reporting sent/delivered/failed status |
| `POST` | `/api/sms-gateway/register` | Phone heartbeat registering its IP, battery, and SIM slot |
| `POST` | `/api/sms-gateway/send` | Send an arbitrary SMS: `{ to: "+254...", message: "..." }` |
| `GET` | `/api/sms-gateway/devices` | Lists currently online Android gateway devices |
| `POST` | `/api/sms-gateway/clear` | Clears completed/pending message history |

---

## 💡 Troubleshooting

- **Phone shows Gateway Inactive:** Ensure Wi-Fi is connected and tap **Start** in the Gateway tab of the MSMS app.
- **Server and Phone not seeing each other:** Make sure both your computer and phone are connected to the same Wi-Fi network (or same mobile hotspot).
- **Dual SIM Selection:** In the Gateway tab on the phone, select the SIM card with your active SMS bundle.
