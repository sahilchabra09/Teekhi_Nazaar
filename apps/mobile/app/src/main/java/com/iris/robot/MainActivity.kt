package com.iris.robot

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.background
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

class MainActivity : ComponentActivity() {
    private val model: RobotViewModel by viewModels()
    private var pending: RobotSettings? = null
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val settings = pending; pending = null
        if (result.values.all { it } && granted() && settings != null) model.start(settings)
        else model.report("Camera and microphone access are required. Enable them in Android app settings if permission was denied permanently.")
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.action == Intent.ACTION_VIEW) intent.data?.let { model.googleCallback(it.toString()) }
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.light(0xFFDCEBE4.toInt(), 0xFFDCEBE4.toInt()),
            navigationBarStyle = SystemBarStyle.light(0xFFDCEBE4.toInt(), 0xFFDCEBE4.toInt()))
        setContent {
            IrisTheme {
                val state by model.state.collectAsStateWithLifecycle()
                LaunchedEffect(state.authorizationUrl) {
                    state.authorizationUrl?.let { url ->
                        model.browserOpened()
                        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)) }
                        catch (_: Exception) { model.cancelGoogle(); model.report("Install a web browser to continue with Google.") }
                    }
                }
                LaunchedEffect(state.running) {
                    if (state.running) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                Surface(Modifier.fillMaxSize()) {
                    if (state.running) RobotScreen(state, model)
                    else Column(Modifier.safeDrawingPadding().padding(20.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column { Text("IRIS", fontSize = 36.sp, fontWeight = FontWeight.ExtraBold); Text("A voice. A presence.", color = Clay.Soft) }
                            Box(Modifier.size(48.dp).clay(Clay.Honey, 24), contentAlignment = Alignment.Center) {
                                Box(Modifier.size(24.dp).clip(RoundedCornerShape(20.dp)).background(Clay.Teal), contentAlignment = Alignment.Center) {
                                    Box(Modifier.size(10.dp).clip(RoundedCornerShape(10.dp)).background(Clay.Pine))
                                }
                            }
                        }
                        state.error?.let { message ->
                            Card(colors = CardDefaults.cardColors(containerColor = Clay.Tomato.copy(alpha = .15f))) {
                                Column(Modifier.padding(12.dp)) { Text(message); TextButton(onClick = model::clearError) { Text("Dismiss") } }
                            }
                        }
                        ClayCard(Modifier.fillMaxWidth()) {
                            Setup(model.initialSettings, state.authBusy, state.awaitingGoogle, model::google, model::cancelGoogle, model::signOut, ::start)
                        }
                    }
                }
            }
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Intent.ACTION_VIEW) intent.data?.let { model.googleCallback(it.toString()) }
    }
    private fun granted() = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO).all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    private fun start(settings: RobotSettings) {
        if (granted()) model.start(settings)
        else { pending = settings; permissions.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)) }
    }
    override fun onPause() { model.background(); super.onPause() }
}

@Composable private fun Setup(initial: RobotSettings, busy: Boolean, awaitingGoogle: Boolean,
    google: (String, Boolean) -> Unit, cancelGoogle: () -> Unit, signOut: () -> Unit, start: (RobotSettings) -> Unit) {
    var hub by remember(initial) { mutableStateOf(initial.hub) }
    var robot by remember(initial) { mutableStateOf(initial.robotEnabled) }
    var broker by remember(initial) { mutableStateOf(initial.broker) }
    var esp by remember(initial) { mutableStateOf(initial.espPassword) }
    var username by remember(initial) { mutableStateOf(initial.brokerUser) }
    var password by remember(initial) { mutableStateOf(initial.brokerPassword) }
    var http by remember(initial) { mutableStateOf(initial.allowLocalSessionHttp) }
    val paired = initial.accountToken.isNotBlank()
    Text("Your presence, anywhere.", fontSize = 27.sp, fontWeight = FontWeight.Bold)
    Text("Connect your phone and laptop to the same hotspot, then start a conversation.", color = Clay.Soft)
    OutlinedTextField(hub, { hub = it }, label = { Text("Laptop backend address") }, placeholder = { Text("192.168.137.1:3000") }, enabled = !paired && !busy,
        singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
    if (!paired) {
        Text("Sign in with your IRIS account", fontSize = 21.sp, fontWeight = FontWeight.Bold)
        Text("Continue with Google using the same email as your laptop. IRIS connects both devices automatically.", color = Clay.Soft)
        Toggle("Allow HTTP on my private laptop hotspot", http, !busy) { http = it }
        if (http) Text("Local testing only. Use HTTPS on a shared network.", fontSize = 13.sp, color = Clay.Soft)
        ClayButton(onClick = { google(hub, http) }, enabled = !busy && hub.isNotBlank(), tone = Clay.Surface,
            modifier = Modifier.fillMaxWidth().height(64.dp)) { Text(if (busy) "Signing in…" else "G   Continue with Google", fontSize = 21.sp) }
        if (awaitingGoogle) {
            Text("Finish signing in with Google in your browser, then return to IRIS.", color = Clay.Soft)
            TextButton(onClick = cancelGoogle, enabled = !busy) { Text("Cancel sign-in") }
        }
        return
    }
    Text("Signed in as", color = Clay.Soft, fontSize = 13.sp)
    Text(initial.accountEmail, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
    Text("Only a laptop signed in to this account can connect to your camera and speech.", color = Clay.Soft, fontSize = 14.sp)
    TextButton(onClick = signOut, enabled = !busy) { Text("Sign out / change account") }
    HorizontalDivider()
    Toggle("Connect ESP robot controller", robot) { robot = it }
    if (robot) {
        OutlinedTextField(broker, { broker = it }, label = { Text("MQTT broker URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Secret("ESP control password", esp) { esp = it }
        OutlinedTextField(username, { username = it }, label = { Text("Broker username (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Secret("Broker password (optional)", password) { password = it }
        Text("Mount upright: phone top up, screen facing the robot’s forward direction. Driving requires calibration, live ESP status, and an authorized backend session.", fontSize = 14.sp)
    }
    ClayButton(onClick = { start(initial.copy(robotEnabled = robot, broker = broker, espPassword = esp, brokerUser = username, brokerPassword = password)) },
        enabled = !busy, modifier = Modifier.fillMaxWidth().height(64.dp)) { Text(if (busy) "Checking account…" else "Start IRIS", fontSize = 23.sp) }
    Text("Camera and microphone are active during the session. IRIS stops when this app becomes inactive.", fontSize = 13.sp, color = Clay.Soft)
}

@Composable private fun Secret(label: String, value: String, change: (String) -> Unit) {
    OutlinedTextField(value, change, label = { Text(label) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
}
@Composable private fun Toggle(label: String, value: Boolean, enabled: Boolean = true, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f)); Switch(checked = value, onCheckedChange = change, enabled = enabled)
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun RobotScreen(state: RobotUiState, model: RobotViewModel) {
    var controls by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("IRIS", fontWeight = FontWeight.Bold, fontSize = 20.sp)
            Spacer(Modifier.weight(1f))
            if (state.robot != null) ClayButton(onClick = model::stopRobot, tone = Clay.Tomato) { Text("STOP") }
            TextButton(onClick = { controls = true }) { Text("Controls") }
        }
        Row(Modifier.fillMaxWidth().clay(radius = 20).padding(14.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            StatusDot("Hub", state.hub)
            StatusDot("Frontend", state.web)
            StatusDot("Camera", state.frontendVideoLive)
        }
        Box(Modifier.weight(1f).fillMaxWidth().clay(radius = 32).padding(10.dp)) {
          Box(Modifier.fillMaxSize().clip(RoundedCornerShape(24.dp)).background(Clay.Pine)) {
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
            if (!state.frontendVideoLive) {
                val (title, hint) = when {
                    !state.hub -> "Connecting to hub" to "Check the laptop address and hotspot connection."
                    !state.web -> "Waiting for your laptop" to "Open the IRIS console with the same account and click Connect phone."
                    state.video == "fallback" -> "Frontend camera needs WebRTC" to "Open Controls and retry WebRTC. Turn off JPEG and Android STT fallback to receive the frontend camera."
                    else -> "Waiting for frontend camera" to "Allow camera access on the laptop and keep Send frontend camera to phone enabled."
                }
                Column(Modifier.fillMaxSize().background(Clay.MistDeep).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(title, fontSize = 25.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(12.dp))
                    Text(hint, fontSize = 17.sp, color = Clay.Soft, textAlign = TextAlign.Center)
                }
            }
          }
        }
        Text(state.caption, fontSize = 25.sp, lineHeight = 31.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            fontWeight = FontWeight.Medium, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp))
        Text(if (state.speaking) "Speaking · microphone paused" else state.listening,
            color = if (state.activeSpeech) Clay.Teal else Clay.Soft, fontSize = 15.sp,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        if (state.error != null) TextButton(onClick = { controls = true }, modifier = Modifier.fillMaxWidth()) {
            Text("Connection or session notice · open Controls", color = Clay.Tomato)
        }
        ClayButton(onClick = model::tap, enabled = !state.speaking && state.sttReady, tone = Clay.Honey,
            modifier = Modifier.fillMaxWidth().height(58.dp)) {
            Text(if (state.activeSpeech) "Tap to send" else "Tap to talk", fontSize = 22.sp)
        }
    }
    if (controls) ModalBottomSheet(onDismissRequest = { controls = false }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Session controls", fontSize = 25.sp, fontWeight = FontWeight.SemiBold)
            Text(state.accountEmail, color = Clay.Teal, fontWeight = FontWeight.SemiBold)
            Text("Hub: ${state.hubLabel} · WebRTC: ${state.video}")
            state.error?.let { message ->
                Card(colors = CardDefaults.cardColors(containerColor = Clay.Tomato.copy(alpha = .15f))) {
                    Column(Modifier.padding(12.dp)) { Text(message); TextButton(onClick = model::clearError) { Text("Dismiss") } }
                }
            }
            SessionControls(state, model)
            OutlinedButton(onClick = { controls = false; model.stop() }, modifier = Modifier.fillMaxWidth()) { Text("End session") }
            TextButton(onClick = { controls = false; model.signOut() }, modifier = Modifier.fillMaxWidth()) { Text("Sign out of this phone") }
        }
    }
}
@Composable private fun SessionControls(state: RobotUiState, model: RobotViewModel) {
    if (state.video == "fallback") Text("JPEG video · ${if (state.androidStt) "tap for Android STT" else "audio clips still upload"}", color = Clay.Soft)
    Toggle("JPEG fallback video", state.jpeg, !state.speaking && state.sttReady) { model.modes(it, state.androidStt) }
    Toggle("Android STT fallback", state.androidStt, !state.speaking && state.sttReady) { model.modes(state.jpeg, it) }
    if (state.androidStt) Text("Uses Android’s recognition service. Video uses JPEG while this mode owns the microphone.", fontSize = 13.sp)
    if (state.video == "fallback" && !state.jpeg && !state.androidStt) TextButton(onClick = { model.modes(false, false) }) { Text("Retry WebRTC") }
    state.robot?.let { robot ->
        HorizontalDivider()
        Text("Robot · ${robot.state}", fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Text(robot.reason)
        Text("ESP ${if (robot.esp_online) "online" else "unavailable"} · ${if (robot.calibrated) "calibrated" else "uncalibrated"} · wheels ${robot.left}, ${robot.right}")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = model::calibrate, Modifier.weight(1f)) { Text("Calibrate") }
            OutlinedButton(onClick = model::fetchSession, Modifier.weight(1f)) { Text("Fetch session") }
        }
        Button(onClick = model::enable, enabled = !state.enabled, modifier = Modifier.fillMaxWidth()) { Text("Enable driving") }
        ClayButton(onClick = model::stopRobot, tone = Clay.Tomato, modifier = Modifier.fillMaxWidth().height(64.dp)) {
            Text("STOP ROBOT", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
    }
}
@Composable private fun StatusDot(label: String, active: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(8.dp)).background(if (active) Clay.Teal else Clay.Soft.copy(alpha = .45f)))
        Text(label, fontSize = 13.sp)
    }
}
