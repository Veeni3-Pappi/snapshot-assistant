package com.msms.model

enum class SmsEnginePhase {
    Idle,
    Queuing,
    Sending,
    Paused,
    Completed,
    Stopped,
}

data class LogEntry(
    val id: Long,
    val text: String,
)

data class SmsEngineUiState(
    val phase: SmsEnginePhase = SmsEnginePhase.Idle,
    val queued: Int = 0,
    val sent: Int = 0,
    val failed: Int = 0,
    val total: Int = 0,
    val currentName: String? = null,
    val currentPhone: String? = null,
    val lastError: String? = null,
    val logs: List<LogEntry> = emptyList(),
) {
    val progress01: Float
        get() = if (total <= 0) 0f else ((sent + failed).coerceAtMost(total)).toFloat() / total.toFloat()

    val remaining: Int
        get() = (total - sent - failed).coerceAtLeast(0)
}
