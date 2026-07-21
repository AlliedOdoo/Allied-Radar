package com.allied.radar.bridge

import org.json.JSONObject

data class CapturedNotification(
    val installationId: String,
    val sourcePackage: String,
    val title: String?,
    val text: String?,
    val postedAt: Long,
    val capturedAt: Long,
    val notificationKey: String?
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("installationId", installationId)
            .put("sourcePackage", sourcePackage)
            .putNullable("title", title)
            .putNullable("text", text)
            .put("postedAt", postedAt)
            .put("capturedAt", capturedAt)
            .putNullable("notificationKey", notificationKey)
    }
}

private fun JSONObject.putNullable(name: String, value: String?): JSONObject {
    return if (value.isNullOrBlank()) {
        put(name, JSONObject.NULL)
    } else {
        put(name, value)
    }
}

