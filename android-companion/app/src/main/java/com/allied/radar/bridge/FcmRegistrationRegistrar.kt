package com.allied.radar.bridge

import android.content.Context

object FcmRegistrationRegistrar {
    fun rememberAndRegister(context: Context, fcmInstallationId: String) {
        val appContext = context.applicationContext
        SecretStore(appContext).putSecret(
            BridgeSecrets.FCM_INSTALLATION_ID,
            fcmInstallationId
        )
        registerStoredInstallation(appContext)
    }

    fun registerStoredInstallation(context: Context) {
        val appContext = context.applicationContext
        val prefs = BridgePrefs(appContext)
        val secrets = SecretStore(appContext)
        val serverUrl = prefs.serverUrl ?: return
        val deviceToken = secrets.getSecret(BridgeSecrets.DEVICE_TOKEN) ?: return
        val fcmInstallationId = secrets.getSecret(BridgeSecrets.FCM_INSTALLATION_ID) ?: return

        Thread {
            runCatching {
                PairingApi(serverUrl).registerFcmInstallation(
                    deviceToken = deviceToken,
                    installationId = prefs.installationId,
                    fcmInstallationId = fcmInstallationId
                )
            }.onSuccess {
                secrets.clearSecret(BridgeSecrets.FCM_INSTALLATION_ID)
            }
        }.start()
    }
}
