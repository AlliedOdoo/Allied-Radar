package com.allied.radar.bridge

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.Executors

class NotificationBridgeService : NotificationListenerService() {
    private val uploadExecutor = Executors.newSingleThreadExecutor()

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in ALLOWED_PACKAGES) return

        val prefs = BridgePrefs(this)
        val serverUrl = prefs.serverUrl ?: return
        val deviceToken = SecretStore(this).getSecret(BridgeSecrets.DEVICE_TOKEN) ?: return

        val payload = CapturedNotification(
            installationId = prefs.installationId,
            sourcePackage = sbn.packageName,
            title = sbn.notification.extras.safeText(Notification.EXTRA_TITLE)?.take(MAX_TITLE_LENGTH),
            text = extractNotificationText(sbn.notification)?.take(MAX_TEXT_LENGTH),
            postedAt = sbn.postTime,
            capturedAt = System.currentTimeMillis(),
            notificationKey = sbn.key?.take(MAX_KEY_LENGTH)
        )

        uploadExecutor.execute {
            runCatching {
                PairingApi(serverUrl).uploadNotification(deviceToken, payload)
            }
        }
    }

    private fun extractNotificationText(notification: Notification): String? {
        val extras = notification.extras
        val bigText = extras.safeText(Notification.EXTRA_BIG_TEXT)
        if (!bigText.isNullOrBlank()) return bigText

        val textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.mapNotNull { it?.toString()?.takeIf(String::isNotBlank) }
            ?.takeIf { it.isNotEmpty() }
            ?.joinToString("\n")
        if (!textLines.isNullOrBlank()) return textLines

        return extras.safeText(Notification.EXTRA_TEXT)
    }

    companion object {
        private val ALLOWED_PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b")
        private const val MAX_TITLE_LENGTH = 300
        private const val MAX_TEXT_LENGTH = 10_000
        private const val MAX_KEY_LENGTH = 512
    }
}

private fun android.os.Bundle.safeText(key: String): String? {
    return getCharSequence(key)?.toString()?.takeIf { it.isNotBlank() }
}
