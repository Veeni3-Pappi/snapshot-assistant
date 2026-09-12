package com.msms.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.telephony.SubscriptionManager
import android.telephony.SmsManager
import androidx.core.app.NotificationCompat
import com.msms.model.Contact
import com.msms.model.LogEntry
import com.msms.model.SmsEnginePhase
import com.msms.model.SmsEngineUiState
import com.msms.receiver.SmsStatusReceiver
import com.msms.sms.SmsCallbackEvent
import com.msms.sms.SmsCallbackHub
import com.msms.util.RecipientsFileStore
import com.msms.util.TelephonyPreconditions
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class SmsService : Service() {

    private val binder = SmsBinder()
    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(serviceJob + Dispatchers.Main.immediate)

    private val _uiState = MutableStateFlow(SmsEngineUiState())
    val uiState = _uiState.asStateFlow()

    private var engineJob: Job? = null
    private val engineRunning = AtomicBoolean(false)

    private val pendingIntentCode = AtomicInteger(1_000_000)
    private val phoneHadSendFailure = ConcurrentHashMap.newKeySet<String>()
    private val pausedEngine = AtomicBoolean(false)

    private var hubCollector: Job? = null
    private var logSeq = 0L

    inner class SmsBinder : Binder() {
        fun getService(): SmsService = this@SmsService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        hubCollector = serviceScope.launch {
            SmsCallbackHub.events.collect { event ->
                when (event) {
                    is SmsCallbackEvent.SentPart -> handleSentPart(event)
                    is SmsCallbackEvent.DeliveryPart -> handleDeliveryPart(event)
                }
            }
        }
    }

    private fun handleSentPart(event: SmsCallbackEvent.SentPart) {
        if (!event.ok) {
            phoneHadSendFailure.add(event.phone)
        }

        appendLog(
            "SENT part ${event.partIndex + 1}/${event.partsTotal} • ${event.phone} (${event.name}) • ok=${event.ok} • result=${event.resultCode}"
        )

        if (event.partIndex == event.partsTotal - 1) {
            val failedForPhone = phoneHadSendFailure.remove(event.phone)
            _uiState.update { state ->
                if (failedForPhone == true) {
                    state.copy(failed = state.failed + 1)
                } else {
                    state.copy(sent = state.sent + 1)
                }
            }
        }
    }

    private fun handleDeliveryPart(event: SmsCallbackEvent.DeliveryPart) {
        appendLog(
            "DELIVERED part ${event.partIndex + 1}/${event.partsTotal} • ${event.phone} (${event.name}) • ok=${event.ok}"
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val path = intent.getStringExtra(EXTRA_RECIPIENTS_FILE)
                val message = intent.getStringExtra(EXTRA_MESSAGE).orEmpty()
                val delayMs = intent.getLongExtra(EXTRA_DELAY_MS, 3_000L).coerceIn(250L, 600_000L)
                if (path.isNullOrBlank() || message.isBlank() || !intent.hasExtra(EXTRA_SUB_ID)) {
                    appendLog("START ignored: missing recipients file, message, or subscription id.")
                    return START_NOT_STICKY
                }
                val subId = intent.getIntExtra(EXTRA_SUB_ID, SubscriptionManager.DEFAULT_SUBSCRIPTION_ID)
                startEngineFromDisk(path, message, subId, delayMs)
            }

            ACTION_PAUSE -> pauseEngine()
            ACTION_RESUME -> resumeEngine()
            ACTION_STOP -> stopEngineUser()
        }
        return START_NOT_STICKY
    }

    private fun startEngineFromDisk(recipientsFilePath: String, message: String, subscriptionId: Int, delayMs: Long) {
        if (!engineRunning.compareAndSet(false, true)) {
            appendLog("Engine already running; ignored new START.")
            return
        }

        engineJob?.cancel()
        phoneHadSendFailure.clear()

        engineJob = serviceScope.launch {
            val file = File(recipientsFilePath)
            val recipients = withContext(Dispatchers.IO) {
                runCatching { RecipientsFileStore.read(file) }.getOrElse { emptyList() }
            }

            if (recipients.isEmpty()) {
                appendLog("No recipients loaded from payload; aborting.")
                val notification = buildNotification("No recipients to send")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                    )
                } else {
                    @Suppress("DEPRECATION")
                    startForeground(NOTIFICATION_ID, notification)
                }
                finishEngine(SmsEnginePhase.Stopped)
                return@launch
            }

            TelephonyPreconditions.describeAirplaneMode(this@SmsService)?.let { appendLog("WARN: $it") }
            TelephonyPreconditions.describeDataConnectivity(this@SmsService)?.let { appendLog("INFO: $it") }
            TelephonyPreconditions.describeSimNotReady(this@SmsService, subscriptionId)?.let {
                appendLog("WARN: $it")
            }

            _uiState.value = SmsEngineUiState(
                phase = SmsEnginePhase.Sending,
                sent = 0,
                failed = 0,
                total = recipients.size,
                currentName = null,
                currentPhone = null,
                lastError = null,
                logs = _uiState.value.logs,
            )

            appendLog("Engine start • recipients=${recipients.size} • subId=$subscriptionId • delayMs=$delayMs • API=${Build.VERSION.SDK_INT}")
            appendLog("NOTE: Delivery receipts depend on carrier/OEM support; absence of DELIVERED lines is normal.")

            val notification = buildNotification("Sending 0/${recipients.size}")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                )
            } else {
                @Suppress("DEPRECATION")
                startForeground(NOTIFICATION_ID, notification)
            }

            try {
                // Queue all messages to Android's SMS framework at once.
                // The framework handles the actual modem send queue.
                // Progress is tracked via sent/delivery callbacks.
                appendLog("Queuing all ${recipients.size} messages to SMS framework...")
                _uiState.update { it.copy(phase = SmsEnginePhase.Queuing) }
                updateNotification("Queuing ${recipients.size} messages...")

                recipients.forEachIndexed { index, contact ->
                    if (!isActive) throw CancellationException("engine cancelled")

                    sendSms(contact, message, subscriptionId)
                    _uiState.update {
                        it.copy(
                            queued = index + 1,
                            currentName = contact.name,
                            currentPhone = contact.phoneNumber,
                        )
                    }
                    if (index % 50 == 49) {
                        updateNotification("Queued ${index + 1}/${recipients.size}")
                    }
                    delay(50)
                }

                appendLog("All ${recipients.size} messages queued — waiting for delivery callbacks...")
                _uiState.update {
                    it.copy(
                        phase = SmsEnginePhase.Sending,
                        currentName = null,
                        currentPhone = null,
                    )
                }
                updateNotification("Queued ${recipients.size} — awaiting delivery")

                // Wait for all sent/failed callbacks to arrive
                while (isActive) {
                    val state = _uiState.value
                    if (state.sent + state.failed >= recipients.size) break
                    updateNotification("Sent ${state.sent}/${recipients.size} (${state.failed} failed)")
                    delay(1_000)
                }

                appendLog("Engine completed — all callbacks received.")
                finishEngine(SmsEnginePhase.Completed)

            } catch (ce: CancellationException) {
                appendLog("Engine cancelled: ${ce.message ?: "stopped"}")
                finishEngine(SmsEnginePhase.Stopped)
            } catch (e: Exception) {
                appendLog("Engine error: ${e.message ?: e.javaClass.simpleName}")
                _uiState.update { it.copy(lastError = e.message) }
                finishEngine(SmsEnginePhase.Stopped)
            }
        }
    }

    private fun pauseEngine() {
        if (!engineRunning.get()) return
        pausedEngine.set(true)
        _uiState.update { it.copy(phase = SmsEnginePhase.Paused) }
        appendLog("PAUSE requested.")
    }

    private fun resumeEngine() {
        pausedEngine.set(false)
        _uiState.update { if (it.phase == SmsEnginePhase.Paused) it.copy(phase = SmsEnginePhase.Sending) else it }
        appendLog("RESUME requested.")
    }

    fun pauseSending() = pauseEngine()
    fun resumeSending() = resumeEngine()

    fun stopSending() = stopEngineUser()
    
    fun clearLogs() {
        _uiState.update { it.copy(logs = emptyList()) }
    }

    private fun stopEngineUser() {
        appendLog("STOP requested by user.")
        engineJob?.cancel()
        finishEngine(SmsEnginePhase.Stopped)
    }

    private fun finishEngine(phase: SmsEnginePhase) {
        engineJob = null
        pausedEngine.set(false)
        engineRunning.set(false)
        _uiState.update {
            it.copy(
                phase = phase,
                currentName = null,
                currentPhone = null,
            )
        }
        // Show final status briefly, then remove the notification entirely
        val finalText = if (phase == SmsEnginePhase.Completed) "Completed" else "Stopped"
        updateNotification("MSMS: $finalText")
        // Use REMOVE to fully dismiss the notification (DETACH keeps it visible on old OEMs)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        // Explicit notification cancel as a fallback for stubborn OEMs
        runCatching {
            getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
        }
        stopSelf()
    }

    private fun sendSms(contact: Contact, message: String, subscriptionId: Int) {
        try {
            val smsManager: SmsManager = obtainSmsManager(subscriptionId)
            appendLog("  SmsManager subId=$subscriptionId • manager.subId=${runCatching { smsManager.subscriptionId }.getOrDefault(-1)}")

            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                // FLAG_MUTABLE allows the SMS framework to write result codes
                // into the PendingIntent on older devices. FLAG_IMMUTABLE can
                // silently break callbacks on some OEMs (Infinix/Tecno/etc.)
                PendingIntent.FLAG_UPDATE_CURRENT
            }

            val parts = smsManager.divideMessage(message)
            if (parts.isNullOrEmpty()) {
                appendLog("ERROR divideMessage returned empty parts for ${contact.phoneNumber}")
                _uiState.update { it.copy(failed = it.failed + 1) }
                return
            }

            val sentIntents = ArrayList<PendingIntent>(parts.size)
            val deliveryIntents = ArrayList<PendingIntent>(parts.size)

            for (i in parts.indices) {
                val sentIntent = Intent(this, SmsStatusReceiver::class.java).apply {
                    action = SmsStatusReceiver.ACTION_SENT
                    putExtra(SmsStatusReceiver.EXTRA_PHONE, contact.phoneNumber)
                    putExtra(SmsStatusReceiver.EXTRA_NAME, contact.name)
                    putExtra(SmsStatusReceiver.EXTRA_PART_INDEX, i)
                    putExtra(SmsStatusReceiver.EXTRA_PARTS_TOTAL, parts.size)
                }
                sentIntents.add(
                    PendingIntent.getBroadcast(
                        this,
                        pendingIntentCode.incrementAndGet(),
                        sentIntent,
                        piFlags,
                    )
                )

                val deliveredIntent = Intent(this, SmsStatusReceiver::class.java).apply {
                    action = SmsStatusReceiver.ACTION_DELIVERED
                    putExtra(SmsStatusReceiver.EXTRA_PHONE, contact.phoneNumber)
                    putExtra(SmsStatusReceiver.EXTRA_NAME, contact.name)
                    putExtra(SmsStatusReceiver.EXTRA_PART_INDEX, i)
                    putExtra(SmsStatusReceiver.EXTRA_PARTS_TOTAL, parts.size)
                }
                deliveryIntents.add(
                    PendingIntent.getBroadcast(
                        this,
                        pendingIntentCode.incrementAndGet(),
                        deliveredIntent,
                        piFlags,
                    )
                )
            }

            if (parts.size == 1) {
                // Single-part: use sendTextMessage for maximum OEM compatibility
                smsManager.sendTextMessage(
                    contact.phoneNumber,
                    null,
                    parts[0],
                    sentIntents[0],
                    deliveryIntents[0],
                )
            } else {
                smsManager.sendMultipartTextMessage(
                    contact.phoneNumber,
                    null,
                    parts,
                    sentIntents,
                    deliveryIntents,
                )
            }
        } catch (e: Exception) {
            appendLog("ERROR send failure for ${contact.phoneNumber}: ${e.javaClass.simpleName}: ${e.message}")
            _uiState.update { it.copy(failed = it.failed + 1) }
        }
    }

    /**
     * Obtains an SmsManager bound to the given [subscriptionId], with
     * multiple fallback strategies for maximum OEM compatibility.
     */
    @Suppress("DEPRECATION")
    private fun obtainSmsManager(subscriptionId: Int): SmsManager {
        // Strategy 1 (API 31+): system service → createForSubscriptionId
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching {
                return getSystemService(SmsManager::class.java)
                    .createForSubscriptionId(subscriptionId)
            }
        }
        // Strategy 2 (API 22–30): deprecated but widely compatible factory method
        runCatching {
            return SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
        }
        // Strategy 3: absolute fallback — default SmsManager (may ignore subscription)
        appendLog("WARN: falling back to SmsManager.getDefault() — SIM routing may be incorrect")
        return SmsManager.getDefault()
    }

    private fun appendLog(line: String) {
        val ts = SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault()).format(Date())
        val entry = LogEntry(++logSeq, "[$ts] $line")
        _uiState.update { state ->
            state.copy(logs = (state.logs + entry).takeLast(MAX_LOG_LINES))
        }
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val stopIntent = Intent(this, SmsService::class.java).apply { action = ACTION_STOP }
        // Use FLAG_MUTABLE on API < 31 for OEM compat, FLAG_IMMUTABLE on 31+
        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val stopPi = PendingIntent.getService(this, 99, stopIntent, piFlags)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MSMS sending")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_delete, "Stop", stopPi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "MSMS SMS sending",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Foreground progress while MSMS sends queued SMS messages."
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    override fun onDestroy() {
        hubCollector?.cancel()
        engineJob?.cancel()
        serviceJob.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.msms.action.START_ENGINE"
        const val ACTION_PAUSE = "com.msms.action.PAUSE_ENGINE"
        const val ACTION_RESUME = "com.msms.action.RESUME_ENGINE"
        const val ACTION_STOP = "com.msms.action.STOP_ENGINE"

        const val EXTRA_RECIPIENTS_FILE = "extra_recipients_file"
        const val EXTRA_MESSAGE = "extra_message"
        const val EXTRA_SUB_ID = "extra_sub_id"
        const val EXTRA_DELAY_MS = "extra_delay_ms"

        private const val CHANNEL_ID = "msms_sms_engine"
        private const val NOTIFICATION_ID = 1001
        private const val MAX_LOG_LINES = 2500
    }
}
