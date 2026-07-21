package com.allied.radar.bridge

import android.app.Service
import android.content.Intent
import android.os.IBinder

class PushUnavailableService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
}
