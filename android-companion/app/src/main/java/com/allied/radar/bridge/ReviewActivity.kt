package com.allied.radar.bridge

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class ReviewActivity : Activity() {
    private lateinit var phoneInput: EditText
    private lateinit var draftInput: EditText
    private lateinit var statusView: TextView
    private lateinit var openWhatsappButton: Button
    private lateinit var openBusinessButton: Button
    private var handoffDraft: HandoffDraft? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val handoffId = intent.getStringExtra(EXTRA_HANDOFF_ID).orEmpty()
        setContentView(buildContentView(handoffId))
        fetchHandoff(handoffId)
    }

    private fun buildContentView(handoffId: String): ScrollView {
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

        stack.addView(label("Review WhatsApp draft", 24, Color.rgb(244, 247, 251)))
        stack.addView(label("Handoff ID: ${handoffId.ifBlank { "none" }}", 13, Color.rgb(170, 180, 195)))
        stack.addView(label("The companion opens WhatsApp with prefilled text only. It never taps Send.", 14, Color.rgb(170, 180, 195)))

        phoneInput = EditText(this).apply {
            hint = "Recipient phone, digits or +E.164"
            inputType = InputType.TYPE_CLASS_PHONE
            setSingleLine(true)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(102, 112, 133))
            isFocusable = false
            isCursorVisible = false
        }
        stack.addView(sectionTitle("Destination"))
        stack.addView(phoneInput)

        draftInput = EditText(this).apply {
            hint = "Draft text to review in WhatsApp"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            minLines = 5
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(102, 112, 133))
            isFocusable = false
            isCursorVisible = false
        }
        stack.addView(sectionTitle("Draft"))
        stack.addView(draftInput)

        openWhatsappButton = button("Open in WhatsApp") {
            openWhatsApp(useBusiness = false)
        }.apply { isEnabled = false }
        stack.addView(openWhatsappButton)

        openBusinessButton = button("Open in WhatsApp Business") {
            openWhatsApp(useBusiness = true)
        }.apply { isEnabled = false }
        stack.addView(openBusinessButton)

        statusView = label("", 14, Color.rgb(170, 180, 195))
        stack.addView(statusView)

        scroll.addView(stack)
        return scroll
    }

    private fun fetchHandoff(handoffId: String) {
        val cleanHandoffId = handoffId.trim()
        if (!HANDOFF_ID_PATTERN.matches(cleanHandoffId)) {
            setOpenButtonsEnabled(false)
            statusView.text = getString(R.string.status_invalid_handoff)
            return
        }

        val prefs = BridgePrefs(this)
        val serverUrl = prefs.serverUrl
        val deviceToken = SecretStore(this).getSecret(BridgeSecrets.DEVICE_TOKEN)

        if (serverUrl.isNullOrBlank() || deviceToken.isNullOrBlank()) {
            setOpenButtonsEnabled(false)
            statusView.text = getString(R.string.status_pair_before_review)
            return
        }

        statusView.text = getString(R.string.status_fetching_handoff)
        Thread {
            val result = runCatching {
                PairingApi(serverUrl).fetchHandoff(
                    deviceToken = deviceToken,
                    handoffId = cleanHandoffId
                )
            }

            runOnUiThread {
                result.onSuccess { draft ->
                    handoffDraft = draft
                    phoneInput.setText(draft.recipientPhone)
                    draftInput.setText(draft.bodyText)
                    setOpenButtonsEnabled(true)
                    statusView.text = getString(R.string.status_handoff_loaded)
                }.onFailure {
                    handoffDraft = null
                    phoneInput.setText("")
                    draftInput.setText("")
                    setOpenButtonsEnabled(false)
                    statusView.text = getString(R.string.status_handoff_fetch_failed)
                }
            }
        }.start()
    }

    private fun openWhatsApp(useBusiness: Boolean) {
        val draft = handoffDraft
        if (draft == null) {
            statusView.text = getString(R.string.status_fetch_before_open)
            return
        }

        val opened = WhatsappLauncher.openChat(
            context = this,
            rawPhone = draft.recipientPhone,
            message = draft.bodyText,
            useBusiness = useBusiness
        )

        statusView.text = if (opened) {
            "Opened WhatsApp. Review the message there and tap Send manually only if correct."
        } else {
            "Could not open WhatsApp. Check the phone number, draft text, and installed app."
        }
    }

    private fun setOpenButtonsEnabled(enabled: Boolean) {
        openWhatsappButton.isEnabled = enabled
        openBusinessButton.isEnabled = enabled
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
        private const val EXTRA_HANDOFF_ID = "handoff_id"
        private val HANDOFF_ID_PATTERN = Regex("^[A-Za-z0-9._:-]{6,256}$")

        fun intentFor(context: Context, handoffId: String): Intent {
            return Intent(context, ReviewActivity::class.java)
                .putExtra(EXTRA_HANDOFF_ID, handoffId)
        }
    }
}
