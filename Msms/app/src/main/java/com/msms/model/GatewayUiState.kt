package com.msms.model

data class GatewayUiState(
    val isRunning: Boolean = false,
    val localIp: String = "Detecting...",
    val serverPort: Int = 8080,
    val backendUrl: String = "http://192.168.0.108:3000",
    val pollingEnabled: Boolean = true,
    val selectedSubId: Int = -1,
    val messagesReceived: Int = 0,
    val messagesDispatched: Int = 0,
    val lastDispatchedPhone: String? = null,
    val lastError: String? = null,
    val logs: List<LogEntry> = emptyList(),
)
