package com.msms.util

import android.telephony.SmsMessage

object SmsEncoding {
    /**
     * Returns (characterCount, segmentCount) using the platform SMS encoding calculator.
     */
    fun calculateSegments(message: String): Pair<Int, Int> {
        if (message.isEmpty()) return 0 to 0
        val r = SmsMessage.calculateLength(message, false)
        val segments = r.getOrNull(1) ?: 0
        val normalizedSegments = if (segments <= 0) 1 else segments
        return message.length to normalizedSegments
    }
}
