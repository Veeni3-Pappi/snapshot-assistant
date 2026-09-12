package com.msms.sms

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

sealed interface SmsCallbackEvent {
    data class SentPart(
        val phone: String,
        val name: String,
        val partIndex: Int,
        val partsTotal: Int,
        val ok: Boolean,
        val resultCode: Int,
    ) : SmsCallbackEvent

    data class DeliveryPart(
        val phone: String,
        val name: String,
        val partIndex: Int,
        val partsTotal: Int,
        val ok: Boolean,
    ) : SmsCallbackEvent
}

object SmsCallbackHub {
    private val _events = MutableSharedFlow<SmsCallbackEvent>(
        extraBufferCapacity = 256,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val events = _events.asSharedFlow()

    fun tryEmit(event: SmsCallbackEvent) {
        _events.tryEmit(event)
    }
}
