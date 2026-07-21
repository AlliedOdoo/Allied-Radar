package com.allied.radar.bridge

import android.net.Uri
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.URL
import javax.net.ssl.HttpsURLConnection

class PairingApi(baseUrl: String) {
    private val baseUrl: String = normalizeBaseUrl(baseUrl)

    fun exchangePairingCode(
        pairingCode: String,
        installationId: String,
        appVersion: String
    ): PairingResponse {
        val request = JSONObject()
            .put("pairingCode", pairingCode)
            .put("installationId", installationId)
            .put("platform", "android")
            .put("appVersion", appVersion)

        val response = postJson(
            path = "/api/mobile/pairing/exchange",
            bearerToken = null,
            body = request
        )

        val deviceToken = response.optString("deviceToken").ifBlank {
            response.optString("token")
        }
        if (deviceToken.isBlank()) throw ApiException("Pairing response did not include a device token.")

        val deviceId = response.optString("deviceId").ifBlank { installationId }
        return PairingResponse(deviceToken = deviceToken, deviceId = deviceId)
    }

    fun uploadNotification(deviceToken: String, notification: CapturedNotification) {
        postJson(
            path = "/api/mobile/notifications",
            bearerToken = deviceToken,
            body = notification.toJson()
        )
    }

    fun registerFcmInstallation(
        deviceToken: String,
        installationId: String,
        fcmInstallationId: String
    ) {
        val request = JSONObject()
            .put("installationId", installationId)
            .put("platform", "android")
            .put("pushProvider", "fcm_fid")
            .put("fcmInstallationId", fcmInstallationId)

        postJson(
            path = "/api/mobile/push-registration",
            bearerToken = deviceToken,
            body = request
        )
    }

    fun fetchHandoff(deviceToken: String, handoffId: String): HandoffDraft {
        val response = getJson(
            path = "/api/mobile/handoffs/${Uri.encode(handoffId)}",
            bearerToken = deviceToken
        )

        val recipientPhone = response.optString("recipientPhone").ifBlank {
            response.optString("phone")
        }
        val bodyText = response.optString("bodyText").ifBlank {
            response.optString("body")
        }

        if (recipientPhone.isBlank() || bodyText.isBlank()) {
            throw ApiException("Handoff response did not include recipient and body.")
        }

        return HandoffDraft(
            handoffId = response.optString("handoffId").ifBlank { handoffId },
            recipientPhone = recipientPhone,
            bodyText = bodyText,
            sourcePackage = response.optString("sourcePackage").ifBlank { null }
        )
    }

    private fun getJson(path: String, bearerToken: String): JSONObject {
        val connection = openJsonConnection(path, "GET", bearerToken)
        return readJsonResponse(connection)
    }

    private fun postJson(path: String, bearerToken: String?, body: JSONObject): JSONObject {
        val connection = openJsonConnection(path, "POST", bearerToken)

        OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
            writer.write(body.toString())
        }

        return readJsonResponse(connection)
    }

    private fun openJsonConnection(
        path: String,
        method: String,
        bearerToken: String?
    ): HttpsURLConnection {
        return (URL("$baseUrl$path").openConnection() as HttpsURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            doOutput = method == "POST"
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "AlliedRadarAndroidCompanion/0.1")
            if (!bearerToken.isNullOrBlank()) {
                setRequestProperty("Authorization", "Bearer $bearerToken")
            }
        }
    }

    private fun readJsonResponse(connection: HttpsURLConnection): JSONObject {
        val code = connection.responseCode
        if (code == 204) {
            connection.disconnect()
            return JSONObject()
        }

        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        connection.disconnect()

        if (code !in 200..299) {
            throw ApiException("Server returned HTTP $code.")
        }

        return if (responseBody.isBlank()) JSONObject() else JSONObject(responseBody)
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS = 15_000

        fun normalizeBaseUrl(input: String): String {
            val trimmed = input.trim().trimEnd('/')
            val uri = Uri.parse(trimmed)
            if (uri.scheme != "https" || uri.host.isNullOrBlank()) {
                throw IllegalArgumentException("Allied mobile bridge requires an HTTPS server URL.")
            }
            return trimmed
        }
    }
}

data class PairingResponse(
    val deviceToken: String,
    val deviceId: String
)

data class HandoffDraft(
    val handoffId: String,
    val recipientPhone: String,
    val bodyText: String,
    val sourcePackage: String?
)

class ApiException(message: String) : Exception(message)
