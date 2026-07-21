package com.allied.radar.bridge

object WhatsappRecipient {
    fun normalizePhone(rawPhone: String): String? {
        val trimmed = rawPhone.trim()
        if (trimmed.isEmpty() || trimmed.any { !it.isDigit() && it !in ALLOWED_FORMATTING }) {
            return null
        }

        val digits = trimmed.filter(Char::isDigit)
        return digits.takeIf { it.length in 8..15 }
    }

    private val ALLOWED_FORMATTING = setOf('+', ' ', '-', '(', ')', '.')
}
