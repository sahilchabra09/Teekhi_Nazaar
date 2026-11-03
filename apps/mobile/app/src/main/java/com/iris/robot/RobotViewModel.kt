package com.iris.robot

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import com.iris.robot.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.webrtc.EglBase
import org.webrtc.VideoTrack

data class RobotUiState(
    val running: Boolean = false,
    val hub: Boolean = false,
    val hubLabel: String = "Offline",
    val web: Boolean = false,
    val video: String = "idle",
    val listening: String = "Ready",
    val activeSpeech: Boolean = false,
    val speaking: Boolean = false,
    val caption: String = "Hello. I’m IRIS.",
    val jpeg: Boolean = false,
    val androidStt: Boolean = false,
    val sttReady: Boolean = true,
    val error: String? = null,
    val robot: MobileStatus? = null,
    val enabled: Boolean = false,
    val remoteTrack: VideoTrack? = null,
    val frontendVideoLive: Boolean = false,
    val eglContext: EglBase.Context? = null,
)

class RobotViewModel(application: Application) : AndroidViewModel(application) {
    private val store = SettingsStore(application)
    private val mutable = MutableStateFlow(RobotUiState())
    val state: StateFlow<RobotUiState> = mutable.asStateFlow()
    var initialSettings = runCatching { store.load() }.getOrElse {
        mutable.update { it.copy(error = "Saved credentials could not be read. Enter setup again.") }; RobotSettings()
    }; private set
    private var session: RobotSession? = null
    fun report(message: String) { mutable.update { it.copy(error = message) } }
    fun clearError() { mutable.update { it.copy(error = null) } }
    fun start(settings: RobotSettings) {
        if (session != null) return
        try {
            val address = HubAddress.parse(settings.hub)
            store.save(settings); initialSettings = settings
            mutable.value = RobotUiState(running = true)
            session = RobotSession(getApplication(), settings, address) { transform -> mutable.update(transform) }
            session!!.start()
        } catch (e: Exception) { stop(); report(e.message ?: "Could not start IRIS") }
    }
    fun stop() {
        session?.close(); session = null
        mutable.update { it.copy(running = false, hub = false, web = false, video = "idle", speaking = false,
            activeSpeech = false, listening = "Stopped", remoteTrack = null, frontendVideoLive = false, eglContext = null, enabled = false) }
    }
    fun background() {
        if (session != null) { stop(); report("IRIS stopped while inactive. Tap Start IRIS to resume.") }
    }
    fun tap() { session?.tap() }
    fun modes(jpeg: Boolean, androidStt: Boolean) { session?.modes(jpeg, androidStt) }
    fun calibrate() { session?.calibrate() }
    fun fetchSession() { session?.fetchSession() }
    fun enable() { session?.enable() }
    fun stopRobot() { session?.stopRobot() }
    override fun onCleared() { stop() }
}

private class RobotSession(
    private val context: Application,
    private val settings: RobotSettings,
    private val address: HubAddress,
    private val update: ((RobotUiState) -> RobotUiState) -> Unit,
) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var closed = false
    private var speaking = false
    private var androidStt = false
    private var jpeg = false
    private var sttReady = true
    private val controller = DriveController()
    private var mqtt: RobotMqttClient? = null
    private var sessions: SessionClient? = null
    private lateinit var hub: HubClient
    private lateinit var listener: Listener
    private lateinit var rtc: RtcClient
    private lateinit var speaker: Speaker
    private lateinit var recognizer: AndroidRecognizer
    private lateinit var motion: Motion
    private fun change(transform: (RobotUiState) -> RobotUiState) {
        scope.launch(Dispatchers.Main.immediate) { if (!closed) update(transform) }
    }
    private fun error(message: String) { change { it.copy(error = message) } }
    fun start() {
        hub = HubClient(address, scope, { connected, label ->
            controller.backendConnectivity(connected)
            change { it.copy(hub = connected, hubLabel = label) }
            if (!connected) { mqtt?.stopOutput(); rtc.peerAvailable(false); change { it.copy(web = false) } }
        }, ::message)
        listener = Listener(context, address, scope, hub::send, { label, active ->
            change { if (it.speaking || it.androidStt) it else it.copy(listening = label, activeSpeech = active) }
        }, ::error)
        recognizer = AndroidRecognizer(context, hub::send, { label, active ->
            change { if (it.speaking) it else it.copy(listening = label, activeSpeech = active) }
        }, ::error)
        rtc = RtcClient(context, listener, hub::send, { value -> change { it.copy(video = value) } },
            { track -> change { it.copy(remoteTrack = track, frontendVideoLive = false, eglContext = if (track != null) rtc.egl.eglBaseContext else null) } },
            { live -> change { it.copy(frontendVideoLive = live) } }, ::error)
        speaker = Speaker(context, address, hub::send, {
            speaking = true; listener.pause(); recognizer.pause()
            change { it.copy(speaking = true, activeSpeech = false, listening = "Speaking; listening paused") }
        }, {
            speaking = false; listener.resumeAfter(); recognizer.resumeAfter()
            scope.launch { delay(500); if (!closed && !speaking) change { it.copy(listening = if (androidStt) "Android STT: tap to talk" else "Listening") } }
        }, { text, active -> change { it.copy(caption = text, speaking = active) } })
        motion = Motion(context, hub::send, controller::updatePose, { kind ->
            controller.fault("Robot $kind; enable required", loseCalibration = kind == "tilt")
            mqtt?.stopOutput(); hub.send(Stop("bump"))
            error("$kind detected. Robot disarmed.")
        })
        rtc.start(); motion.start(); hub.start()
        if (settings.robotEnabled) {
            if (!motion.available) error("Rotation vector and gyro are required for driving")
            mqtt = RobotMqttClient(settings, controller, scope, { status ->
                change { it.copy(robot = status, enabled = controller.enabled) }
            }, ::error).also { it.start() }
            sessions = SessionClient(address, settings, scope, { grant, at, rtt ->
                val wasEnabled = controller.enabled
                controller.grant(grant, at, rtt)
                if (wasEnabled && !controller.enabled) mqtt?.stopOutput()
            }, { reason -> controller.revoke(reason); mqtt?.stopOutput(); error(reason) })
        }
    }
    private fun message(msg: Msg) {
        when (msg) {
            is PeerStatus -> { rtc.peerAvailable(msg.web); change { it.copy(web = msg.web) } }
            is MediaReady -> if (msg.device_id == controller.deviceId &&
                (msg.control_session_id == null || controller.sessionId == null || msg.control_session_id == controller.sessionId)) {
                rtc.requestOffer()
            }
            is Speak -> speaker.speak(msg)
            is RtcAnswer, is RtcIce -> rtc.accept(msg)
            is Stop -> mqtt?.stop("Hub requested stop")
            is SessionRevoked -> if (msg.device_id == controller.deviceId && msg.control_session_id == controller.sessionId) {
                controller.revoke("Backend revoked control session"); mqtt?.stopOutput()
            }
            is HubError -> error(msg.message)
            else -> Unit
        }
    }
    fun modes(forceJpeg: Boolean, recognize: Boolean) {
        if (speaking) return
        jpeg = forceJpeg; androidStt = recognize; sttReady = false
        recognizer.pause(); listener.setEnabled(!recognize)
        change { it.copy(jpeg = forceJpeg, androidStt = recognize, sttReady = false, activeSpeech = false, listening = "Switching microphone") }
        rtc.setModes(forceJpeg, recognize) {
            scope.launch {
                if (closed) return@launch
                sttReady = true; recognizer.resumeAfter()
                change { it.copy(sttReady = true, listening = if (recognize) "Android STT: tap to talk" else "Listening") }
            }
        }
    }
    fun tap() { if (!speaking && sttReady) { if (androidStt) recognizer.tap() else listener.tap() } }
    fun calibrate() {
        mqtt?.stop("Calibration requested")
        if (motion.calibrate()) controller.calibrate(SystemClock.elapsedRealtime())
        else { controller.fault("Mount phone upright and wait for fresh sensors", true); error("Mount the phone upright, with the screen facing forward, then calibrate") }
    }
    fun fetchSession() { sessions?.start() }
    fun enable() { if (!controller.enable(SystemClock.elapsedRealtime())) error(controller.reason) }
    fun stopRobot() { mqtt?.stop("Operator stopped"); hub.send(Stop("user")) }
    override fun close() {
        if (closed) return
        closed = true
        sessions?.close(); mqtt?.close()
        if (::motion.isInitialized) motion.close()
        if (::speaker.isInitialized) speaker.close()
        if (::recognizer.isInitialized) recognizer.close()
        if (::rtc.isInitialized) rtc.close()
        if (::listener.isInitialized) listener.close()
        if (::hub.isInitialized) hub.close()
        scope.cancel()
    }
}
