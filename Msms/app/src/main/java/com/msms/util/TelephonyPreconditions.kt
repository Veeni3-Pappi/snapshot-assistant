package com.msms.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings
import android.telephony.TelephonyManager
import androidx.core.content.getSystemService

object TelephonyPreconditions {

    fun describeAirplaneMode(context: Context): String? {
        return try {
            val on = Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) != 0
            if (on) "Airplane mode is enabled; SMS may fail until it is disabled." else null
        } catch (_: Exception) {
            null
        }
    }

    fun describeDataConnectivity(context: Context): String? {
        val cm = context.getSystemService<ConnectivityManager>() ?: return null
        val network = cm.activeNetwork ?: return "No active data network reported (SMS may still work over CS domain)."
        val caps = cm.getNetworkCapabilities(network) ?: return null
        val hasCell = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
        val hasWifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        if (!hasCell && !hasWifi) {
            return "No cellular or Wi‑Fi transport is active; verify signal and radio state."
        }
        return null
    }

    fun describeSimNotReady(context: Context, subscriptionId: Int): String? {
        return try {
            val tm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                context.getSystemService(TelephonyManager::class.java)?.createForSubscriptionId(subscriptionId)
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(TelephonyManager::class.java)
            } ?: return "TelephonyManager unavailable."

            when (tm.simState) {
                TelephonyManager.SIM_STATE_ABSENT -> "No SIM is present for the selected subscription."
                TelephonyManager.SIM_STATE_PIN_REQUIRED,
                TelephonyManager.SIM_STATE_PUK_REQUIRED,
                TelephonyManager.SIM_STATE_NETWORK_LOCKED -> "SIM is locked; unlock the SIM before sending."
                TelephonyManager.SIM_STATE_UNKNOWN -> "SIM state is unknown; verify telephony is enabled."
                else -> null
            }
        } catch (e: Exception) {
            "Unable to read SIM state: ${e.message ?: e.javaClass.simpleName}"
        }
    }
}
