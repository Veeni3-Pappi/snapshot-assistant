package com.msms.receiver

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.msms.sms.SmsCallbackEvent
import com.msms.sms.SmsCallbackHub

/**
 * Receives per-part SMS sent/delivery callbacks from [android.app.PendingIntent] broadcasts.
 *
 * This receiver is declared with `android:exported="false"` and is only targeted via explicit
 * `Intent#setClass` calls from the app, which is the reliable pattern on modern Android releases.
 */
class SmsStatusReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null) return
        val phone = intent.getStringExtra(EXTRA_PHONE).orEmpty()
        val name = intent.getStringExtra(EXTRA_NAME).orEmpty()
        val partIndex = intent.getIntExtra(EXTRA_PART_INDEX, 0)
        val partsTotal = intent.getIntExtra(EXTRA_PARTS_TOTAL, 1).coerceAtLeast(1)

        when (intent.action) {
            ACTION_SENT -> {
                val ok = resultCode == Activity.RESULT_OK
                SmsCallbackHub.tryEmit(
                    SmsCallbackEvent.SentPart(
                        phone = phone,
                        name = name,
                        partIndex = partIndex,
                        partsTotal = partsTotal,
                        ok = ok,
                        resultCode = resultCode,
                    )
                )
            }

            ACTION_DELIVERED -> {
                // Delivery receipts are not universally supported; treat OK as "receipt received".
                val ok = resultCode == Activity.RESULT_OK
                SmsCallbackHub.tryEmit(
                    SmsCallbackEvent.DeliveryPart(
                        phone = phone,
                        name = name,
                        partIndex = partIndex,
                        partsTotal = partsTotal,
                        ok = ok,
                    )
                )
            }
        }
    }

    companion object {
        const val ACTION_SENT = "com.msms.action.SMS_SENT"
        const val ACTION_DELIVERED = "com.msms.action.SMS_DELIVERED"

        const val EXTRA_PHONE = "extra_phone"
        const val EXTRA_NAME = "extra_name"
        const val EXTRA_PART_INDEX = "extra_part_index"
        const val EXTRA_PARTS_TOTAL = "extra_parts_total"
    }
}
