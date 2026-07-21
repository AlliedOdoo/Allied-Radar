package com.allied.radar.bridge

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

object HandoffNotifier {
    fun showReviewNotification(context: Context, handoffId: String) {
        val appContext = context.applicationContext
        NotificationChannels.ensure(appContext)

        val intent = ReviewActivity.intentFor(appContext, handoffId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)

        val pendingIntent = PendingIntent.getActivity(
            appContext,
            handoffId.hashCode() and 0x7fffffff,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = Notification.Builder(appContext, NotificationChannels.HANDOFFS)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("Review WhatsApp draft")
            .setContentText("Tap to fetch and review this Allied Radar handoff.")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        appContext
            .getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_BASE_ID + (handoffId.hashCode() and 0x0000ffff), notification)
    }

    private const val NOTIFICATION_BASE_ID = 48_000
}

