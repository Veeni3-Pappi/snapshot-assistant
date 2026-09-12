package com.msms.repository

import android.annotation.SuppressLint
import android.content.Context
import android.telephony.SubscriptionManager
import com.msms.model.SimInfo

class SimRepository(private val context: Context) {

    @SuppressLint("MissingPermission")
    fun getActiveSimCards(): List<SimInfo> {
        val sm = context.getSystemService(SubscriptionManager::class.java) ?: return emptyList()
        val active = sm.activeSubscriptionInfoList ?: return emptyList()

        return active.map { info ->
            val simLabel = "SIM ${info.simSlotIndex + 1}"
            val display = buildString {
                val carrierOrName = info.displayName?.toString()?.trim().orEmpty()
                if (carrierOrName.isNotBlank()) {
                    append("$simLabel ($carrierOrName)")
                } else {
                    append(simLabel)
                }
            }
            @Suppress("DEPRECATION")
            val number = info.number.orEmpty()
            SimInfo(
                subscriptionId = info.subscriptionId,
                slotIndex = info.simSlotIndex,
                displayName = display,
                carrierName = info.carrierName?.toString().orEmpty(),
                number = number,
            )
        }
    }
}
