package com.allied.radar.bridge

import android.content.Context
import java.util.UUID

class BridgePrefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var serverUrl: String?
        get() = prefs.getString(KEY_SERVER_URL, null)
        set(value) {
            prefs.edit().putString(KEY_SERVER_URL, value).apply()
        }

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) {
            prefs.edit().putString(KEY_DEVICE_ID, value).apply()
        }

    val installationId: String
        get() {
            val existing = prefs.getString(KEY_INSTALLATION_ID, null)
            if (!existing.isNullOrBlank()) return existing

            val generated = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_INSTALLATION_ID, generated).apply()
            return generated
        }

    companion object {
        private const val PREFS_NAME = "allied_radar_bridge"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_INSTALLATION_ID = "installation_id"
    }
}

