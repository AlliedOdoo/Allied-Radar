package com.allied.radar.bridge

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class FirebaseHandoffService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.notification != null) return
        if (message.data.keys != setOf(KEY_HANDOFF_ID)) return

        val handoffId = message.data[KEY_HANDOFF_ID]
            ?.trim()
            ?.takeIf { HANDOFF_ID_PATTERN.matches(it) }
            ?: return

        HandoffNotifier.showReviewNotification(this, handoffId)
    }

    override fun onRegistered(installationId: String) {
        if (installationId.isBlank()) return
        FcmRegistrationRegistrar.rememberAndRegister(this, installationId)
    }

    companion object {
        private const val KEY_HANDOFF_ID = "handoff_id"
        private val HANDOFF_ID_PATTERN = Regex("^[A-Za-z0-9._:-]{6,256}$")
    }
}
