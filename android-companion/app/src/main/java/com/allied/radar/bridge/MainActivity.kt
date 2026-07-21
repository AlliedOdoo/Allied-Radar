package com.allied.radar.bridge

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var prefs: BridgePrefs
    private lateinit var secrets: SecretStore
    private lateinit var serverUrlInput: EditText
    private lateinit var pairingCodeInput: EditText
    private lateinit var statusView: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        prefs = BridgePrefs(this)
        secrets = SecretStore(this)
        NotificationChannels.ensure(this)

        setContentView(buildContentView())
        updateStatus("Ready.")
    }

    override fun onResume() {
        super.onResume()
        updateStatus("Notification access: ${if (isNotificationAccessEnabled()) "enabled" else "not enabled"}.")
    }

    private fun buildContentView(): ScrollView {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.rgb(8, 10, 15))
        }

        val stack = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        stack.addView(label("Allied Radar Bridge", 24, Color.rgb(244, 247, 251)))
        stack.addView(label("WhatsApp notification bridge. Draft-only outbound handoff.", 14, Color.rgb(170, 180, 195)))

        serverUrlInput = EditText(this).apply {
            hint = "https://your-allied-server.example"
            setText(prefs.serverUrl.orEmpty())
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(102, 112, 133))
        }
        stack.addView(sectionTitle("Server URL"))
        stack.addView(serverUrlInput)

        pairingCodeInput = EditText(this).apply {
            hint = "Pairing code"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(102, 112, 133))
        }
        stack.addView(sectionTitle("Pairing"))
        stack.addView(pairingCodeInput)

        stack.addView(button("Save server URL") { saveServerUrl() })
        stack.addView(button("Pair device") { pairDevice() })
        stack.addView(button("Open notification access settings") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        })
        stack.addView(button("Check notification access") {
            updateStatus("Notification access: ${if (isNotificationAccessEnabled()) "enabled" else "not enabled"}.")
        })
        stack.addView(button("Request Android 13+ notification permission") {
            requestPostNotificationPermission()
        })
        stack.addView(button("Forget local pairing") { confirmForgetPairing() })

        statusView = label("", 14, Color.rgb(170, 180, 195))
        statusView.setPadding(0, dp(16), 0, 0)
        stack.addView(statusView)

        scroll.addView(stack)
        return scroll
    }

    private fun saveServerUrl() {
        val rawUrl = serverUrlInput.text.toString()
        runCatching {
            PairingApi.normalizeBaseUrl(rawUrl)
        }.onSuccess { normalized ->
            prefs.serverUrl = normalized
            updateStatus("Server URL saved.")
        }.onFailure {
            updateStatus("Use a valid HTTPS server URL.")
        }
    }

    private fun pairDevice() {
        val serverUrl = runCatching { PairingApi.normalizeBaseUrl(serverUrlInput.text.toString()) }.getOrNull()
        val pairingCode = pairingCodeInput.text.toString().trim()

        if (serverUrl.isNullOrBlank()) {
            updateStatus("Enter a valid HTTPS server URL before pairing.")
            return
        }

        if (pairingCode.length < 4) {
            updateStatus("Enter the pairing code from Allied Radar.")
            return
        }

        updateStatus("Pairing device...")
        Thread {
            val result = runCatching {
                PairingApi(serverUrl).exchangePairingCode(
                    pairingCode = pairingCode,
                    installationId = prefs.installationId,
                    appVersion = BuildConfig.VERSION_NAME
                )
            }

            runOnUiThread {
                result.onSuccess { response ->
                    prefs.serverUrl = serverUrl
                    prefs.deviceId = response.deviceId
                    secrets.putSecret(BridgeSecrets.DEVICE_TOKEN, response.deviceToken)
                    pairingCodeInput.setText("")
                    if (BuildConfig.FIREBASE_ENABLED) {
                        FcmRegistrationRegistrar.registerStoredInstallation(this)
                    }
                    updateStatus("Paired. Device token stored with Android Keystore-backed encryption.")
                }.onFailure {
                    updateStatus("Pairing failed. Check the code and server URL.")
                }
            }
        }.start()
    }

    private fun requestPostNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) {
            updateStatus("Runtime notification permission is not required before Android 13.")
            return
        }

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            updateStatus("Android notification permission already granted.")
            return
        }

        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_POST_NOTIFICATIONS)
    }

    private fun confirmForgetPairing() {
        if (secrets.getSecret(BridgeSecrets.DEVICE_TOKEN) == null) {
            updateStatus("This phone is not paired.")
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Forget this pairing?")
            .setMessage("This removes the local device and push tokens. Revoke the old device in Allied Radar too if this phone is lost or no longer trusted.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Forget") { _, _ ->
                secrets.clearSecret(BridgeSecrets.DEVICE_TOKEN)
                secrets.clearSecret(BridgeSecrets.FCM_INSTALLATION_ID)
                prefs.deviceId = null
                updateStatus("Local pairing removed. Pair again to reconnect this phone.")
            }
            .show()
    }

    private fun isNotificationAccessEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?: return false
        val expected = ComponentName(this, NotificationBridgeService::class.java)
        return enabled
            .split(":")
            .mapNotNull { ComponentName.unflattenFromString(it) }
            .any { it.packageName == expected.packageName && it.className == expected.className }
    }

    private fun updateStatus(message: String) {
        val paired = secrets.getSecret(BridgeSecrets.DEVICE_TOKEN) != null
        val notificationAccess = if (isNotificationAccessEnabled()) "enabled" else "not enabled"
        statusView.text = listOf(
            "Status: $message",
            "Server: ${prefs.serverUrl ?: "not set"}",
            "Paired: ${if (paired) "yes" else "no"}",
            "Notification access: $notificationAccess",
            "Phone push: ${if (BuildConfig.FIREBASE_ENABLED) "configured" else "waiting for Firebase config"}",
            "Outbound: opens WhatsApp for manual send only"
        ).joinToString("\n")
    }

    private fun label(text: String, sizeSp: Int, color: Int): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = sizeSp.toFloat()
            setTextColor(color)
            setPadding(0, dp(4), 0, dp(8))
        }
    }

    private fun sectionTitle(text: String): TextView {
        return label(text, 12, Color.rgb(124, 92, 255)).apply {
            setPadding(0, dp(20), 0, dp(4))
        }
    }

    private fun button(text: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            this.text = text
            isAllCaps = false
            setOnClickListener { onClick() }
        }
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    companion object {
        private const val REQUEST_POST_NOTIFICATIONS = 4100
    }
}
