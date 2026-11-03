package com.iris.robot

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
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
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFF8CE8D4), background = Color(0xFF091416), surface = Color(0xFF142427))) {
                val state by model.state.collectAsStateWithLifecycle()
                LaunchedEffect(state.running) {
                    if (state.running) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                Surface(Modifier.fillMaxSize()) {
                    if (state.running) RobotScreen(state, model)
                    else Column(Modifier.safeDrawingPadding().padding(20.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column { Text("IRIS", fontSize = 30.sp, fontWeight = FontWeight.Bold); Text("A voice. A presence.", color = Color(0xFF9BB6B5)) }
                        }
                        state.error?.let { message ->
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF472C26))) {
                                Column(Modifier.padding(12.dp)) { Text(message); TextButton(onClick = model::clearError) { Text("Dismiss") } }
                            }
                        }
                        Setup(model.initialSettings, ::start)
                    }
                }
            }
        }
    }
    private fun granted() = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO).all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    private fun start(settings: RobotSettings) {
        if (granted()) model.start(settings)
        else { pending = settings; permissions.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)) }
    }
    override fun onPause() { model.background(); super.onPause() }
}

@Composable private fun Setup(initial: RobotSettings, start: (RobotSettings) -> Unit) {
    var hub by remember(initial) { mutableStateOf(initial.hub) }
    var robot by remember(initial) { mutableStateOf(initial.robotEnabled) }
    var broker by remember(initial) { mutableStateOf(initial.broker) }
    var esp by remember(initial) { mutableStateOf(initial.espPassword) }
    var token by remember(initial) { mutableStateOf(initial.sessionToken) }
    var username by remember(initial) { mutableStateOf(initial.brokerUser) }
    var password by remember(initial) { mutableStateOf(initial.brokerPassword) }
    var http by remember(initial) { mutableStateOf(initial.allowLocalSessionHttp) }
    Text("Put IRIS on the robot", fontSize = 25.sp, fontWeight = FontWeight.SemiBold)
    Text("Connect the phone and laptop to the same hotspot. Enter the laptop’s address below.", color = Color(0xFFB4C7C5))
    OutlinedTextField(hub, { hub = it }, label = { Text("Hub address") }, placeholder = { Text("192.168.1.10:3000") },
        singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
    Toggle("Connect ESP robot controller", robot) { robot = it }
    if (robot) {
        OutlinedTextField(broker, { broker = it }, label = { Text("MQTT broker URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Secret("ESP control password", esp) { esp = it }
        Secret("Backend session token", token) { token = it }
        OutlinedTextField(username, { username = it }, label = { Text("Broker username (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Secret("Broker password (optional)", password) { password = it }
        Toggle("Allow session HTTP on a private LAN", http) { http = it }
        if (http) Text("Bench testing only: your token travels without encryption. Use HTTPS for a protected deployment.", color = Color(0xFFFFC68D), fontSize = 13.sp)
        Text("Mount upright: phone top up, screen facing the robot’s forward direction. Driving requires calibration, live ESP status, and an authorized backend session.", fontSize = 14.sp)
    }
    Button(onClick = { start(RobotSettings(hub, robot, broker, esp, username, password, token, http)) },
        enabled = hub.isNotBlank(), modifier = Modifier.fillMaxWidth().height(64.dp)) { Text("Start IRIS", fontSize = 23.sp) }
    Text("Camera and microphone are active during the session. IRIS stops when this app becomes inactive.", fontSize = 13.sp, color = Color(0xFF9BB6B5))
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
            if (state.robot != null) Button(onClick = model::stopRobot,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFAC333A))) { Text("STOP", color = Color.White) }
            TextButton(onClick = { controls = true }) { Text("Controls") }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            StatusDot("Hub", state.hub)
            StatusDot("Frontend", state.web)
            StatusDot("Camera", state.frontendVideoLive)
        }
        Box(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.Black)) {
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
                    !state.web -> "Waiting for frontend" to "Open the robot viewer on the laptop and click Connect."
                    state.video == "fallback" -> "Frontend camera needs WebRTC" to "Open Controls and retry WebRTC. Turn off JPEG and Android STT fallback to receive the frontend camera."
                    else -> "Waiting for frontend camera" to "Allow camera access on the laptop and keep Send frontend camera to phone enabled."
                }
                Column(Modifier.fillMaxSize().background(Color(0xFF102427)).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(title, fontSize = 25.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(12.dp))
                    Text(hint, fontSize = 17.sp, color = Color(0xFFB4C7C5), textAlign = TextAlign.Center)
                }
            }
        }
        Text(state.caption, fontSize = 25.sp, lineHeight = 31.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
            fontWeight = FontWeight.Medium, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp))
        Text(if (state.speaking) "Speaking · microphone paused" else state.listening,
            color = if (state.activeSpeech) Color(0xFFFFCE84) else Color(0xFF8CE8D4), fontSize = 15.sp,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        if (state.error != null) TextButton(onClick = { controls = true }, modifier = Modifier.fillMaxWidth()) {
            Text("Connection or session notice · open Controls", color = Color(0xFFFFC68D))
        }
        Button(onClick = model::tap, enabled = !state.speaking && state.sttReady,
            modifier = Modifier.fillMaxWidth().height(58.dp)) {
            Text(if (state.activeSpeech) "Tap to send" else "Tap to talk", fontSize = 22.sp)
        }
    }
    if (controls) ModalBottomSheet(onDismissRequest = { controls = false }) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Session controls", fontSize = 25.sp, fontWeight = FontWeight.SemiBold)
            Text("Hub: ${state.hubLabel} · WebRTC: ${state.video}")
            state.error?.let { message ->
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF472C26))) {
                    Column(Modifier.padding(12.dp)) { Text(message); TextButton(onClick = model::clearError) { Text("Dismiss") } }
                }
            }
            SessionControls(state, model)
            OutlinedButton(onClick = { controls = false; model.stop() }, modifier = Modifier.fillMaxWidth()) { Text("End session") }
        }
    }
}
@Composable private fun SessionControls(state: RobotUiState, model: RobotViewModel) {
    if (state.video == "fallback") Text("JPEG video · ${if (state.androidStt) "tap for Android STT" else "audio clips still upload"}", color = Color(0xFFFFC68D))
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
        Button(onClick = model::stopRobot, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFAC333A)), modifier = Modifier.fillMaxWidth().height(64.dp)) {
            Text("STOP ROBOT", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
    }
}
@Composable private fun StatusDot(label: String, active: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(8.dp)).background(if (active) Color(0xFF8CE8D4) else Color(0xFF647773)))
        Text(label, fontSize = 13.sp)
    }
}
