package com.allied.radar.bridge

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

object WhatsappLauncher {
    private const val WHATSAPP_PACKAGE = "com.whatsapp"
    private const val WHATSAPP_BUSINESS_PACKAGE = "com.whatsapp.w4b"

    fun openChat(
        context: Context,
        rawPhone: String,
        message: String,
        useBusiness: Boolean
    ): Boolean {
        val phone = WhatsappRecipient.normalizePhone(rawPhone) ?: return false
        if (message.isBlank()) return false

        val uri = Uri.Builder()
            .scheme("https")
            .authority("wa.me")
            .appendPath(phone)
            .appendQueryParameter("text", message)
            .build()

        val packageName = if (useBusiness) WHATSAPP_BUSINESS_PACKAGE else WHATSAPP_PACKAGE
        val targetedIntent = Intent(Intent.ACTION_VIEW, uri).setPackage(packageName)

        return try {
            context.startActivity(targetedIntent)
            true
        } catch (_: ActivityNotFoundException) {
            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
            }.isSuccess
        }
    }
}
