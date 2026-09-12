package com.msms.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import androidx.core.app.NotificationCompat
import com.msms.MainActivity
import com.msms.model.GatewayUiState
import com.msms.model.LogEntry
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
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class GatewayService : Service() {

    private val binder = GatewayBinder()
    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(serviceJob + Dispatchers.Default)

    private var serverSocket: ServerSocket? = null
    private var serverJob: Job? = null
    private var pollingJob: Job? = null
    private val isRunning = AtomicBoolean(false)
    private val pendingCode = AtomicInteger(200_000)

    inner class GatewayBinder : Binder() {
        fun getService(): GatewayService = this@GatewayService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        detectLocalIp()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val port = intent.getIntExtra(EXTRA_PORT, 8080)
                val backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL) ?: "http://192.168.0.108:3000"
                val pollingEnabled = intent.getBooleanExtra(EXTRA_POLLING, true)
                val subId = intent.getIntExtra(EXTRA_SUB_ID, -1)

                startGateway(port, backendUrl, pollingEnabled, subId)
            }
            ACTION_STOP -> stopGateway()
        }
        return START_NOT_STICKY
    }

    private fun startGateway(port: Int, backendUrl: String, pollingEnabled: Boolean, subId: Int) {
        if (!isRunning.compareAndSet(false, true)) {
            appendLog("Gateway already running.")
            return
        }

        _uiState.update {
            it.copy(
                isRunning = true,
                serverPort = port,
                backendUrl = backendUrl,
                pollingEnabled = pollingEnabled,
                selectedSubId = subId,
                lastError = null
            )
        }

        val notification = buildNotification("Gateway Active on port $port")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            @Suppress("DEPRECATION")
            startForeground(NOTIFICATION_ID, notification)
        }

        appendLog("SMS Gateway started on port $port")
        detectLocalIp()

        // Start embedded HTTP server
        startHttpServer(port)

        // Start polling & heartbeat worker if enabled
        if (pollingEnabled && backendUrl.isNotBlank()) {
            startPollingWorker(backendUrl)
        }
    }

    private fun stopGateway() {
        if (!isRunning.compareAndSet(true, false)) return

        appendLog("Stopping SMS Gateway...")
        serverJob?.cancel()
        pollingJob?.cancel()

        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        serverSocket = null

        _uiState.update { it.copy(isRunning = false) }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
        appendLog("SMS Gateway stopped.")
    }

    private fun startHttpServer(port: Int) {
        serverJob?.cancel()
        serverJob = serviceScope.launch(Dispatchers.IO) {
            try {
                serverSocket = ServerSocket(port).apply {
                    reuseAddress = true
                }
                appendLog("HTTP Server listening on 0.0.0.0:$port")

                while (isActive && isRunning.get()) {
                    try {
                        val clientSocket = serverSocket?.accept() ?: break
                        serviceScope.launch(Dispatchers.IO) {
                            handleClientSocket(clientSocket)
                        }
                    } catch (e: Exception) {
                        if (!isActive || !isRunning.get()) break
                        appendLog("Server socket accept error: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                appendLog("Failed to bind port $port: ${e.message}")
                _uiState.update { it.copy(lastError = "Port $port error: ${e.message}") }
            }
        }
    }

    private fun handleClientSocket(socket: Socket) {
        socket.use { s ->
            try {
                val reader = BufferedReader(InputStreamReader(s.getInputStream()))
                val output: OutputStream = s.getOutputStream()

                val firstLine = reader.readLine() ?: return
                val parts = firstLine.split(" ")
                if (parts.size < 2) return
                val method = parts[0]
                val path = parts[1]

                // Read headers
                var contentLength = 0
                var line: String?
                while (reader.readLine().also { line = it } != null && !line.isNullOrEmpty()) {
                    val lower = line!!.lowercase(Locale.ROOT)
                    if (lower.startsWith("content-length:")) {
                        contentLength = lower.substringAfter(":").trim().toIntOrNull() ?: 0
                    }
                }

                // Read body
                val body = if (contentLength > 0) {
                    val charArray = CharArray(contentLength)
                    var read = 0
                    while (read < contentLength) {
                        val r = reader.read(charArray, read, contentLength - read)
                        if (r == -1) break
                        read += r
                    }
                    String(charArray, 0, read)
                } else ""

                if (method == "GET" && (path == "/health" || path == "/status" || path == "/")) {
                    val state = _uiState.value
                    val sm = getSystemService(SubscriptionManager::class.java)
                    val simArray = JSONArray()
                    sm?.activeSubscriptionInfoList?.forEach { sub ->
                        simArray.put(JSONObject().apply {
                            put("slot", sub.simSlotIndex)
                            put("simNumber", sub.simSlotIndex + 1)
                            put("subId", sub.subscriptionId)
                            put("carrier", sub.carrierName?.toString() ?: "Safaricom")
                            put("displayName", sub.displayName?.toString() ?: "Safaricom")
                        })
                    }

                    val resObj = JSONObject().apply {
                        put("status", "ok")
                        put("app", "msms-smsgt")
                        put("version", "1.0")
                        put("running", true)
                        put("ip", state.localIp)
                        put("port", state.serverPort)
                        put("messagesDispatched", state.messagesDispatched)
                        put("sims", simArray)
                    }
                    sendHttpResponse(output, 200, resObj.toString())
                } else if (method == "POST" && (path == "/send" || path == "/message" || path.startsWith("/api/v1/message"))) {
                    handleDirectSendRequest(body, output)
                } else {
                    sendHttpResponse(output, 404, "{\"error\":\"Not Found\"}")
                }
            } catch (e: Exception) {
                appendLog("Client request handling error: ${e.message}")
            }
        }
    }

    private fun handleDirectSendRequest(body: String, output: OutputStream) {
        try {
            val json = JSONObject(body)
            var to = json.optString("to", "")
            if (to.isBlank() && json.has("phoneNumbers")) {
                val array = json.optJSONArray("phoneNumbers")
                if (array != null && array.length() > 0) {
                    to = array.getString(0)
                }
            }
            val message = json.optString("message", "")
            val subId = if (json.has("subId")) {
                json.getInt("subId")
            } else if (json.has("simSlot")) {
                json.getInt("simSlot")
            } else {
                _uiState.value.selectedSubId
            }

            if (to.isBlank() || message.isBlank()) {
                sendHttpResponse(output, 400, "{\"success\":false,\"error\":\"'to' and 'message' fields required\"}")
                return
            }

            _uiState.update { it.copy(messagesReceived = it.messagesReceived + 1) }
            appendLog("Direct HTTP request: Send to $to (len=${message.length})")

            val dispatchResult = executeSmsSend(to, message, subId)
            if (dispatchResult.success) {
                val resObj = JSONObject().apply {
                    put("success", true)
                    put("messageId", "direct_${System.currentTimeMillis()}")
                    put("recipient", to)
                    put("parts", dispatchResult.parts)
                }
                sendHttpResponse(output, 200, resObj.toString())
            } else {
                val resObj = JSONObject().apply {
                    put("success", false)
                    put("error", dispatchResult.error)
                }
                sendHttpResponse(output, 500, resObj.toString())
            }
        } catch (e: Exception) {
            sendHttpResponse(output, 500, "{\"success\":false,\"error\":\"${e.message}\"}")
        }
    }

    private fun sendHttpResponse(output: OutputStream, code: Int, json: String) {
        val statusText = if (code == 200) "OK" else if (code == 400) "Bad Request" else if (code == 404) "Not Found" else "Error"
        val bytes = json.toByteArray(Charsets.UTF_8)
        val header = "HTTP/1.1 $code $statusText\r\n" +
                "Content-Type: application/json; charset=utf-8\r\n" +
                "Content-Length: ${bytes.size}\r\n" +
                "Connection: close\r\n\r\n"
        output.write(header.toByteArray(Charsets.UTF_8))
        output.write(bytes)
        output.flush()
    }

    private fun startPollingWorker(backendUrl: String) {
        pollingJob?.cancel()
        pollingJob = serviceScope.launch(Dispatchers.IO) {
            appendLog("Polling worker started for $backendUrl")
            var heartbeatCounter = 0

            while (isActive && isRunning.get()) {
                try {
                    // Send registration/heartbeat every 30s
                    if (heartbeatCounter % 6 == 0) {
                        sendHeartbeat(backendUrl)
                    }
                    heartbeatCounter++

                    // Poll pending messages
                    pollPendingQueue(backendUrl)
                } catch (e: Exception) {
                    if (e !is CancellationException) {
                        // Silent retry or log only occasionally
                    }
                }
                delay(5_000)
            }
        }
    }

    private fun sendHeartbeat(backendUrl: String) {
        try {
            val url = URL("$backendUrl/api/sms-gateway/register")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 4000
            conn.readTimeout = 4000
            conn.doOutput = true

            val state = _uiState.value
            val sm = getSystemService(SubscriptionManager::class.java)
            val simList = JSONArray()
            sm?.activeSubscriptionInfoList?.forEach { sub ->
                simList.put(JSONObject().apply {
                    put("slot", sub.simSlotIndex)
                    put("simNumber", sub.simSlotIndex + 1)
                    put("subId", sub.subscriptionId)
                    put("carrier", sub.carrierName?.toString() ?: "Safaricom")
                    put("displayName", sub.displayName?.toString() ?: "Safaricom")
                })
            }

            val payload = JSONObject().apply {
                put("deviceId", "msms_${Build.MANUFACTURER}_${Build.MODEL}".replace(" ", "_"))
                put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
                put("ip", state.localIp)
                put("port", state.serverPort)
                put("gatewayUrl", "http://${state.localIp}:${state.serverPort}")
                put("appVersion", "1.0")
                put("sims", simList)
            }

            conn.outputStream.use { os ->
                os.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
            conn.responseCode
            conn.disconnect()
        } catch (_: Exception) {}
    }

    private fun pollPendingQueue(backendUrl: String) {
        try {
            val url = URL("$backendUrl/api/sms-gateway/pending?limit=5")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 4000
            conn.readTimeout = 4000

            if (conn.responseCode == 200) {
                val res = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(res)
                val messages = json.optJSONArray("messages") ?: JSONArray()

                for (i in 0 until messages.length()) {
                    val msgObj = messages.getJSONObject(i)
                    val id = msgObj.getString("id")
                    val to = msgObj.getString("to")
                    val text = msgObj.getString("message")
                    val subId = msgObj.optInt("simSlot", _uiState.value.selectedSubId)

                    appendLog("Polled queue: Sending $id to $to")
                    _uiState.update { it.copy(messagesReceived = it.messagesReceived + 1) }

                    val result = executeSmsSend(to, text, subId)
                    reportStatusBack(backendUrl, id, result)
                }
            }
            conn.disconnect()
        } catch (_: Exception) {}
    }

    private fun reportStatusBack(backendUrl: String, messageId: String, result: SendResult) {
        try {
            val url = URL("$backendUrl/api/sms-gateway/status")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 4000
            conn.readTimeout = 4000
            conn.doOutput = true

            val payload = JSONObject().apply {
                put("messageId", messageId)
                put("status", if (result.success) "sent" else "failed")
                if (!result.success && result.error != null) {
                    put("error", result.error)
                }
                put("parts", result.parts)
            }

            conn.outputStream.use { os ->
                os.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
            conn.responseCode
            conn.disconnect()
        } catch (e: Exception) {
            appendLog("Failed to report status for $messageId: ${e.message}")
        }
    }

    data class SendResult(val success: Boolean, val parts: Int = 1, val error: String? = null)

    private fun executeSmsSend(phone: String, message: String, subscriptionId: Int): SendResult {
        return try {
            val smsManager = obtainSmsManager(subscriptionId)
            val parts = smsManager.divideMessage(message)
            if (parts.isNullOrEmpty()) {
                return SendResult(false, 0, "divideMessage returned empty parts")
            }

            val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }

            val sentIntents = ArrayList<PendingIntent>(parts.size)
            for (i in parts.indices) {
                val intent = Intent("com.msms.action.GATEWAY_SMS_SENT")
                sentIntents.add(
                    PendingIntent.getBroadcast(this, pendingCode.incrementAndGet(), intent, piFlags)
                )
            }

            if (parts.size == 1) {
                smsManager.sendTextMessage(phone, null, parts[0], sentIntents[0], null)
            } else {
                smsManager.sendMultipartTextMessage(phone, null, parts, sentIntents, null)
            }

            _uiState.update {
                it.copy(
                    messagesDispatched = it.messagesDispatched + 1,
                    lastDispatchedPhone = phone
                )
            }
            appendLog("✅ SMS dispatched to $phone (${parts.size} part(s))")
            updateNotification("Sent: ${_uiState.value.messagesDispatched} | Last: $phone")
            SendResult(true, parts.size)
        } catch (e: Exception) {
            appendLog("❌ Send failed for $phone: ${e.message}")
            _uiState.update { it.copy(lastError = e.message) }
            SendResult(false, 0, e.message)
        }
    }

    @Suppress("DEPRECATION")
    private fun obtainSmsManager(requestedSubIdOrSlot: Int): SmsManager {
        val sm = getSystemService(SubscriptionManager::class.java)
        var actualSubId = -1

        if (sm != null) {
            val active = runCatching { sm.activeSubscriptionInfoList }.getOrNull()
            if (!active.isNullOrEmpty()) {
                // If requested is 0 or 1, match slotIndex
                if (requestedSubIdOrSlot in 0..1) {
                    val bySlot = active.find { it.simSlotIndex == requestedSubIdOrSlot }
                    if (bySlot != null) {
                        actualSubId = bySlot.subscriptionId
                        appendLog("Using SIM Slot ${bySlot.simSlotIndex + 1} (${bySlot.displayName ?: "Safaricom"}, subId=${bySlot.subscriptionId})")
                    }
                } else if (requestedSubIdOrSlot in 1..2 && active.any { it.simSlotIndex == requestedSubIdOrSlot - 1 }) {
                    // Match 1-based index (1 = SIM 1, 2 = SIM 2)
                    val by1BasedSlot = active.find { it.simSlotIndex == requestedSubIdOrSlot - 1 }
                    if (by1BasedSlot != null) {
                        actualSubId = by1BasedSlot.subscriptionId
                        appendLog("Using SIM Slot ${by1BasedSlot.simSlotIndex + 1} (${by1BasedSlot.displayName ?: "Safaricom"}, subId=${by1BasedSlot.subscriptionId})")
                    }
                } else if (requestedSubIdOrSlot > 0) {
                    // Match by direct subscriptionId
                    val bySub = active.find { it.subscriptionId == requestedSubIdOrSlot }
                    if (bySub != null) {
                        actualSubId = bySub.subscriptionId
                        appendLog("Using SIM by subId: Slot ${bySub.simSlotIndex + 1} (${bySub.displayName ?: "Safaricom"}, subId=${bySub.subscriptionId})")
                    }
                }
            }

            if (actualSubId < 0) {
                actualSubId = SubscriptionManager.getDefaultSmsSubscriptionId()
                appendLog("Using Default SMS SIM subId=$actualSubId")
            }
        }

        if (actualSubId >= 0 && actualSubId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                runCatching {
                    return getSystemService(SmsManager::class.java).createForSubscriptionId(actualSubId)
                }
            }
            runCatching {
                return SmsManager.getSmsManagerForSubscriptionId(actualSubId)
            }
        }
        return SmsManager.getDefault()
    }

    private fun detectLocalIp() {
        serviceScope.launch(Dispatchers.IO) {
            try {
                val interfaces = NetworkInterface.getNetworkInterfaces()
                for (intf in interfaces) {
                    val addrs = intf.inetAddresses
                    for (addr in addrs) {
                        if (!addr.isLoopbackAddress && addr is Inet4Address) {
                            val ipStr = addr.hostAddress ?: ""
                            if (ipStr.isNotBlank()) {
                                withContext(Dispatchers.Main) {
                                    _uiState.update { it.copy(localIp = ipStr) }
                                }
                                return@launch
                            }
                        }
                    }
                }
            } catch (_: Exception) {}
        }
    }

    private fun appendLog(line: String) {
        val ts = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        val entry = LogEntry(System.currentTimeMillis(), "[$ts] $line")
        _uiState.update { state ->
            state.copy(logs = (state.logs + entry).takeLast(200))
        }
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm?.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java)
        val stopIntent = Intent(this, GatewayService::class.java).apply { action = ACTION_STOP }

        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val openPi = PendingIntent.getActivity(this, 101, openIntent, piFlags)
        val stopPi = PendingIntent.getService(this, 102, stopIntent, piFlags)

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MSMS SMS Gateway")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setContentIntent(openPi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "MSMS Gateway Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Maintains active SMS gateway server and queue polling."
        }
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        stopGateway()
        serviceJob.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.msms.action.START_GATEWAY"
        const val ACTION_STOP = "com.msms.action.STOP_GATEWAY"

        const val EXTRA_PORT = "extra_port"
        const val EXTRA_BACKEND_URL = "extra_backend_url"
        const val EXTRA_POLLING = "extra_polling"
        const val EXTRA_SUB_ID = "extra_sub_id"

        private const val CHANNEL_ID = "msms_gateway_channel"
        private const val NOTIFICATION_ID = 2002

        val _uiState = MutableStateFlow(GatewayUiState())
        val uiState = _uiState.asStateFlow()

        fun start(context: Context, port: Int = 8080, backendUrl: String = "http://192.168.0.108:3000", polling: Boolean = true, subId: Int = -1) {
            val intent = Intent(context, GatewayService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_PORT, port)
                putExtra(EXTRA_BACKEND_URL, backendUrl)
                putExtra(EXTRA_POLLING, polling)
                putExtra(EXTRA_SUB_ID, subId)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, GatewayService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
