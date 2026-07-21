package com.allied.radar.bridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

object NotificationChannels {
    const val HANDOFFS = "allied_radar_handoffs"

    fun ensure(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val existing = manager.getNotificationChannel(HANDOFFS)
        if (existing != null) return

        val channel = NotificationChannel(
            HANDOFFS,
            "Allied draft handoffs",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Review notifications for Allied Radar WhatsApp draft handoffs."
        }

        manager.createNotificationChannel(channel)
    }
}
