package com.allied.radar.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WhatsappRecipientTest {
    @Test
    fun normalizesE164FormattingToDigits() {
        assertEquals("27821234567", WhatsappRecipient.normalizePhone("+27 82 123 4567"))
    }

    @Test
    fun rejectsNumbersThatAreTooShortOrTooLong() {
        assertNull(WhatsappRecipient.normalizePhone("1234567"))
        assertNull(WhatsappRecipient.normalizePhone("1234567890123456"))
    }

    @Test
    fun rejectsInputWithoutDigits() {
        assertNull(WhatsappRecipient.normalizePhone("not a phone number"))
    }

    @Test
    fun rejectsLettersMixedIntoAnOtherwiseValidNumber() {
        assertNull(WhatsappRecipient.normalizePhone("account 27821234567"))
    }
}
