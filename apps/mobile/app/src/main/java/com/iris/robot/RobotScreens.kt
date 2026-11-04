package com.iris.robot

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import android.content.res.Configuration
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.iris.robot.core.ListenPhase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import androidx.compose.ui.viewinterop.AndroidView

@Composable internal fun IrisApp(state: RobotUiState, initial: RobotSettings, model: RobotViewModel, start: (RobotSettings) -> Unit) {
    if (state.running) SessionScreen(state, model)
    else WelcomeScreen(initial, state, model::google, model::cancelGoogle, model::signOut, model::clearError, start)
}

@Composable private fun WelcomeScreen(initial: RobotSettings, state: RobotUiState,
    google: (String, Boolean) -> Unit, cancelGoogle: () -> Unit, signOut: () -> Unit,
    clearError: () -> Unit, start: (RobotSettings) -> Unit) {
    var draft by remember(initial) { mutableStateOf(initial) }
    var settings by remember { mutableStateOf(false) }
    val signedIn = initial.accountToken.isNotBlank()
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 24.dp).padding(top = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        IrisHeader({ settings = true }, enabled = !state.authBusy)
        state.error?.let { Notice(it, clearError) }
        val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
        val intro: @Composable () -> Unit = {
                Box(Modifier.size(if (landscape) 64.dp else 88.dp).clay(Clay.Sky, 28), contentAlignment = Alignment.Center) {
                    IrisSymbol(Symbol.Laptop, Modifier.size(38.dp))
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (signedIn) "Ready to connect" else "Welcome to IRIS", style = if (landscape) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.headlineLarge, textAlign = TextAlign.Center)
                    if (!signedIn) Text("Sign in with the same Google account as your laptop.", style = MaterialTheme.typography.bodyLarge,
                        color = Clay.Soft, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 8.dp))
                }
        }
        val actions: @Composable () -> Unit = {
                if (signedIn) AccountSummary(initial.accountEmail)
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(if (landscape) 8.dp else 12.dp)) {
                    if (signedIn) ClayButton(onClick = { start(draft) }, enabled = !state.authBusy, modifier = Modifier.fillMaxWidth()) {
                        if (state.authBusy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                        Text(if (state.authBusy) "Connecting…" else "Start session", Modifier.padding(horizontal = 10.dp).weight(1f), textAlign = TextAlign.Center)
                        if (!state.authBusy) IrisSymbol(Symbol.Arrow, tint = Color.White)
                    } else ClayButton(onClick = { google(draft.hub, draft.allowLocalSessionHttp) }, enabled = !state.authBusy && draft.hub.isNotBlank(),
                        tone = Clay.Surface, modifier = Modifier.fillMaxWidth()) {
                        if (state.authBusy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Image(painterResource(R.drawable.ic_google), contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(if (state.authBusy) "Signing in…" else "Continue with Google")
                    }
                    if (state.awaitingGoogle && !signedIn) {
                        Text("Finish signing in in your browser.", style = MaterialTheme.typography.bodyMedium, color = Clay.Soft)
                        TextButton(onClick = cancelGoogle, enabled = !state.authBusy) { Text("Cancel sign-in") }
                    }
                }
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Clay.Surface.copy(alpha = .65f))
                    .clickable(enabled = !state.authBusy, role = Role.Button) { settings = true }.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (landscape) 8.dp else 12.dp)) {
                    IrisSymbol(Symbol.Laptop, tint = Clay.Soft)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Laptop connection", style = MaterialTheme.typography.labelLarge)
                        Text(draft.hub, style = MaterialTheme.typography.bodySmall, color = Clay.Soft, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IrisSymbol(Symbol.Chevron, Modifier.size(18.dp), Clay.Soft)
                }
                if (signedIn) Text("The camera turns on when the session starts. The patient answers your conversation request to turn on the microphone.", style = MaterialTheme.typography.bodySmall,
                    color = Clay.Soft, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 12.dp))
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            if (landscape && maxWidth >= 540.dp) {
                Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(.85f).fillMaxHeight().verticalScroll(rememberScrollState()).padding(vertical = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) { intro() }
                    Column(Modifier.weight(1.15f).fillMaxHeight().verticalScroll(rememberScrollState()).padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) { actions() }
                }
            } else {
                Column(Modifier.align(Alignment.Center).widthIn(max = 480.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = 28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    intro()
                    actions()
                }
            }
        }
    }
    if (settings) ConnectionSettings(draft, signedIn, state.authBusy, { draft = it }, signOut = {
        settings = false; signOut()
    }, dismiss = { settings = false })
}

@Composable private fun ConnectionSettings(draft: RobotSettings, signedIn: Boolean, busy: Boolean,
    change: (RobotSettings) -> Unit, signOut: () -> Unit, dismiss: () -> Unit) {
    IrisSheet("Settings", dismiss) {
        if (signedIn) {
            AccountSummary(draft.accountEmail)
            TextButton(onClick = signOut, enabled = !busy) { Text("Sign out", color = Clay.Tomato) }
            HorizontalDivider(color = Clay.Pine.copy(alpha = .08f))
        }
        SectionLabel("Connection")
        if (!signedIn) TextButton(onClick = { change(draft.withUsbConnection()) }, enabled = !busy) {
            Text("Use USB connection")
        }
        IrisField("Server address", draft.hub, enabled = !signedIn && !busy,
            hint = USB_HUB, keyboard = KeyboardType.Uri) { hub ->
            val localHttp = draft.allowLocalSessionHttp && (draft.hub != USB_HUB || hub == USB_HUB)
            change(draft.copy(hub = hub, allowLocalSessionHttp = localHttp))
        }
        if (signedIn) Text("Sign out to change the server.", style = MaterialTheme.typography.bodySmall, color = Clay.Soft)
        else SettingToggle("Local connection (HTTP)", draft.allowLocalSessionHttp, !busy,
            "For a private laptop or USB connection.") { change(draft.copy(allowLocalSessionHttp = it)) }
        if (signedIn) {
            HorizontalDivider(color = Clay.Pine.copy(alpha = .08f))
            Disclosure("Robot controller") {
                SettingToggle("Enable robot controller", draft.robotEnabled, !busy) { change(draft.copy(robotEnabled = it)) }
                if (draft.robotEnabled) {
                    IrisField("MQTT broker", draft.broker, keyboard = KeyboardType.Uri) { change(draft.copy(broker = it)) }
                    IrisField("Control password", draft.espPassword, secret = true) { change(draft.copy(espPassword = it)) }
                    IrisField("Broker username (optional)", draft.brokerUser) { change(draft.copy(brokerUser = it)) }
                    IrisField("Broker password (optional)", draft.brokerPassword, secret = true) { change(draft.copy(brokerPassword = it)) }
                    Text("Mount the phone upright before calibration.", style = MaterialTheme.typography.bodySmall, color = Clay.Soft)
                }
            }
        }
        ClayButton(onClick = dismiss, modifier = Modifier.fillMaxWidth()) { Text("Done") }
    }
}

@Composable private fun SessionScreen(state: RobotUiState, model: RobotViewModel) {
    var settings by remember { mutableStateOf(false) }
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val status = when {
        !state.hub -> "Offline"
        !state.web -> "Standby"
        state.frontendVideoLive -> "Live"
        else -> "Connected"
    }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 16.dp).padding(top = 10.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(if (landscape) 8.dp else 16.dp)) {
        IrisHeader({ settings = true }, stop = if (state.robot != null) model::stopRobot else null)
        if (!landscape) Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Laptop camera", style = MaterialTheme.typography.labelLarge, color = Clay.Soft)
            StatusPill(status, state.frontendVideoLive)
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            if (landscape && maxWidth >= 540.dp) {
                Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    SessionVideo(state, Modifier.weight(1.6f).fillMaxHeight())
                    Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("Laptop camera", style = MaterialTheme.typography.labelMedium, color = Clay.Soft)
                            StatusPill(status, state.frontendVideoLive)
                        }
                        SessionSpeech(state, model::tap) { settings = true }
                    }
                }
            } else {
                Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    SessionVideo(state, Modifier.weight(1f).fillMaxWidth())
                    SessionSpeech(state, model::tap) { settings = true }
                }
            }
        }
    }
    if (settings) SessionSettings(state, model) { settings = false }
}

@Composable private fun SessionVideo(state: RobotUiState, modifier: Modifier = Modifier) {
    Box(modifier.clay(radius = 28).padding(7.dp)) {
            Box(Modifier.fillMaxSize().clip(RoundedCornerShape(22.dp)).background(Clay.Pine)) {
                val track = state.remoteTrack
                val egl = state.eglContext
                if (track != null && egl != null) key(track) {
                    AndroidView(factory = { context -> SurfaceViewRenderer(context).apply {
                        init(egl, null)
                        setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                        setEnableHardwareScaler(true)
                        track.addSink(this)
                    } }, modifier = Modifier.fillMaxSize(),
                        onRelease = { renderer -> runCatching { track.removeSink(renderer) }; renderer.release() })
                }
                if (!state.frontendVideoLive) CameraWaiting(state)
            }
        }
}

@Composable private fun SessionSpeech(state: RobotUiState, microphone: () -> Unit, openSettings: () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Clay.Surface).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val phase = state.listenPhase
        val label = when {
            state.speaking -> "IRIS is speaking"
            !state.sttReady -> "Preparing microphone"
            !state.hub || !state.web -> "Connect the patient dashboard to communicate"
            phase == ListenPhase.IDLE && state.listening == "Ready" -> "Request a conversation with the patient"
            else -> state.listening
        }
        Text(label, style = MaterialTheme.typography.labelMedium, color = Clay.Teal)
        if (state.caption.isNotBlank()) Text(state.caption, style = MaterialTheme.typography.titleMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
        if (phase == ListenPhase.IDLE || phase == ListenPhase.PENDING) {
            ClayButton(onClick = microphone, modifier = Modifier.fillMaxWidth(),
                enabled = state.hub && state.web && state.sttReady && !state.speaking && phase == ListenPhase.IDLE) {
                IrisSymbol(Symbol.Mic, Modifier.size(20.dp), LocalContentColor.current)
                Spacer(Modifier.width(8.dp))
                Text(if (phase == ListenPhase.PENDING) "Waiting for answer" else "Request conversation")
            }
        } else {
            StatusPill("Call active", live = true)
            Text("The patient can end this call from their dashboard.", style = MaterialTheme.typography.bodySmall, color = Clay.Soft)
        }
        if (state.error != null) TextButton(onClick = openSettings) { Text("View session notice", color = Clay.Tomato) }
    }
}

@Composable private fun CameraWaiting(state: RobotUiState) {
    val (title, hint) = when {
        !state.hub -> "Reconnecting" to "Check your laptop connection."
        !state.web -> "Waiting for your laptop" to "Open IRIS on your laptop and select Connect phone."
        state.video == "fallback" -> "Live camera unavailable" to "Retry live video in Settings."
        else -> "Waiting for the camera" to "Share your camera from the laptop."
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(Clay.Field)) {
      Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = maxHeight).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
        Box(Modifier.size(60.dp).clip(RoundedCornerShape(20.dp)).background(Clay.Surface), contentAlignment = Alignment.Center) {
            IrisSymbol(Symbol.Camera, Modifier.size(28.dp), Clay.Teal)
        }
        Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        Text(hint, style = MaterialTheme.typography.bodyMedium, color = Clay.Soft, textAlign = TextAlign.Center)
      }
    }
}

@Composable private fun SessionSettings(state: RobotUiState, model: RobotViewModel, dismiss: () -> Unit) {
    IrisSheet("Session settings", dismiss) {
        AccountSummary(state.accountEmail)
        state.error?.let { Notice(it, model::clearError) }
        SectionLabel("Audio & video")
        Column {
            SettingToggle("Compatibility video", state.jpeg, !state.speaking && state.sttReady,
                "Use still frames if live video fails.") { model.modes(it, state.androidStt) }
            SettingToggle("Phone speech recognition", state.androidStt, !state.speaking && state.sttReady,
                "Use Android’s speech service.") { model.modes(state.jpeg, it) }
        }
        if (state.video == "fallback") {
            Text("Laptop video is unavailable in compatibility mode.", style = MaterialTheme.typography.bodySmall, color = Clay.Soft)
            OutlinedButton(onClick = { model.modes(false, false) }, enabled = !state.speaking && state.sttReady, modifier = Modifier.fillMaxWidth()) { Text("Retry live video") }
        }
        state.robot?.let { robot ->
            HorizontalDivider(color = Clay.Pine.copy(alpha = .08f))
            SectionLabel("Robot controller")
            Text(robot.reason, style = MaterialTheme.typography.bodyMedium)
            Text("${if (robot.esp_online) "Robot online" else "Robot offline"} · ${if (robot.calibrated) "Calibrated" else "Calibration needed"}",
                style = MaterialTheme.typography.bodySmall, color = Clay.Soft)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = model::calibrate, modifier = Modifier.weight(1f)) { Text("Calibrate") }
                OutlinedButton(onClick = model::fetchSession, modifier = Modifier.weight(1f)) { Text("Authorize") }
            }
            ClayButton(onClick = model::enable, enabled = !state.enabled, modifier = Modifier.fillMaxWidth()) { Text("Enable driving") }
            ClayButton(onClick = model::stopRobot, tone = Clay.Tomato, modifier = Modifier.fillMaxWidth()) { Text("Stop robot") }
        }
        HorizontalDivider(color = Clay.Pine.copy(alpha = .08f))
        Disclosure("Connection details") {
            Text("Server: ${state.hubLabel}\nLaptop: ${if (state.web) "connected" else "offline"}\nVideo: ${state.video}\nMicrophone: ${state.listening}",
                style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = Clay.Soft)
            state.robot?.let { Text("Controller: ${it.state}\nWheels: ${it.left}, ${it.right}", style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace, color = Clay.Soft) }
        }
        OutlinedButton(onClick = { dismiss(); model.stop() }, modifier = Modifier.fillMaxWidth()) { Text("End session") }
        TextButton(onClick = { dismiss(); model.signOut() }, modifier = Modifier.fillMaxWidth()) { Text("Sign out", color = Clay.Tomato) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun IrisSheet(title: String, dismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val windowHeight = LocalWindowInfo.current.containerSize.height
    val maxSheetHeight = with(LocalDensity.current) { windowHeight.toDp() * .85f }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Clay.Surface, shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), tonalElevation = 0.dp) {
        Column(Modifier.fillMaxWidth().heightIn(max = maxSheetHeight)
            .verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding().padding(horizontal = 24.dp).padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                IconButton(onClick = dismiss, modifier = Modifier.semantics { contentDescription = "Close settings" }) { IrisSymbol(Symbol.Close, tint = Clay.Soft) }
            }
            content()
        }
    }
}

@Composable private fun SectionLabel(title: String) { Text(title, style = MaterialTheme.typography.titleMedium) }

@Composable private fun Disclosure(title: String, content: @Composable ColumnScope.() -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { expanded = !expanded },
            verticalAlignment = Alignment.CenterVertically) {
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            IrisSymbol(Symbol.Chevron, Modifier.size(18.dp).graphicsLayer { rotationZ = if (expanded) 90f else 0f }, Clay.Soft)
        }
        if (expanded) content()
    }
}

@Composable private fun IrisField(label: String, value: String, enabled: Boolean = true, hint: String? = null,
    secret: Boolean = false, keyboard: KeyboardType = KeyboardType.Text, change: (String) -> Unit) {
    OutlinedTextField(value, change, label = { Text(label) }, placeholder = hint?.let { { Text(it) } }, enabled = enabled,
        singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (secret) KeyboardType.Password else keyboard),
        colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Clay.Field, unfocusedContainerColor = Clay.Field,
            disabledContainerColor = Clay.Field, unfocusedBorderColor = Clay.Pine.copy(alpha = .15f)))
}

@Preview(widthDp = 360, heightDp = 740, fontScale = 1.3f, showBackground = true)
@Composable private fun WelcomePreview() {
    IrisTheme { Surface(color = Clay.Mist) { WelcomeScreen(RobotSettings(hub = "localhost:3000"), RobotUiState(), { _, _ -> }, {}, {}, {}, {}) } }
}
