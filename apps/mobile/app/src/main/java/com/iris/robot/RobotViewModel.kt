package com.iris.robot

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
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
    val caption: String = "",
    val jpeg: Boolean = false,
    val androidStt: Boolean = false,
    val sttReady: Boolean = true,
    val error: String? = null,
    val robot: MobileStatus? = null,
    val enabled: Boolean = false,
    val remoteTrack: VideoTrack? = null,
    val frontendVideoLive: Boolean = false,
    val eglContext: EglBase.Context? = null,
    val accountEmail: String = "",
    val authBusy: Boolean = false,
    val authorizationUrl: String? = null,
    val awaitingGoogle: Boolean = false,
)

class RobotViewModel(application: Application) : AndroidViewModel(application) {
    private val store = SettingsStore(application)
    private val mutable = MutableStateFlow(RobotUiState())
    val state: StateFlow<RobotUiState> = mutable.asStateFlow()
    var initialSettings = runCatching { store.load() }.getOrElse {
        mutable.update { it.copy(error = "Saved credentials could not be read. Enter setup again.") }; RobotSettings()
    }; private set
    private var session: RobotSession? = null
    private var authJob: Job? = null
    init {
        // Credentials from the retired manual-code flow must sign in with Google.
        if (initialSettings.accountToken.isNotBlank() && initialSettings.accountProvider != "google") {
            initialSettings = initialSettings.copy(accountToken = "", accountEmail = "", accountExpiresAt = 0)
            runCatching { store.save(initialSettings) }
        }
        mutable.update { it.copy(accountEmail = initialSettings.accountEmail, awaitingGoogle = initialSettings.pendingOAuth != null) }
    }
    fun report(message: String) { mutable.update { it.copy(error = message) } }
    fun clearError() { mutable.update { it.copy(error = null) } }
    fun google(hub: String, localHttp: Boolean) {
        if (state.value.authBusy) return
        mutable.update { it.copy(authBusy = true, error = null) }
        authJob = viewModelScope.launch {
            try {
                val attempt = OAuthAttempt.create()
                val settings = initialSettings.copy(hub = hub.trim(), allowLocalSessionHttp = localHttp,
                    accountToken = "", accountEmail = "", accountExpiresAt = 0, pendingOAuth = attempt)
                val result = withContext(Dispatchers.IO) { AccountClient(settings).use { it.begin(attempt) } }
                ensureActive()
                // Persist state and verifier before leaving for the browser. Android can
                // recreate the process while Google is open; callback handling still works.
                store.save(settings); initialSettings = settings
                mutable.update { it.copy(authorizationUrl = result.authorization_url, awaitingGoogle = true) }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { report(e.message ?: "Could not open Google sign-in. Check your laptop address.") }
            finally { mutable.update { it.copy(authBusy = false) } }
        }
    }
    fun browserOpened() { mutable.update { it.copy(authorizationUrl = null) } }
    fun cancelGoogle() {
        initialSettings = initialSettings.copy(pendingOAuth = null)
        runCatching { store.save(initialSettings) }
        mutable.update { it.copy(authorizationUrl = null, awaitingGoogle = false) }
    }
    fun googleCallback(raw: String) {
        if (state.value.authBusy) return
        val attempt = initialSettings.pendingOAuth ?: return
        val result = try { attempt.callback(raw, System.currentTimeMillis()) }
            catch (e: Exception) { report(e.message ?: "Invalid Google return link"); return }
        if (result is OAuthResult.Failed) { cancelGoogle(); report(result.message); return }
        result as OAuthResult.Success
        mutable.update { it.copy(authBusy = true, error = null, authorizationUrl = null) }
        val settings = initialSettings
        authJob = viewModelScope.launch {
            try {
                val account = withContext(Dispatchers.IO) { AccountClient(settings).use { it.complete(result.code, attempt) } }
                ensureActive()
                require(account.token.isNotBlank() && account.expires_at_ms > System.currentTimeMillis()) { "Invalid account authorization" }
                val linked = settings.copy(accountToken = account.token, accountEmail = account.user.email, accountExpiresAt = account.expires_at_ms,
                    accountProvider = "google", pendingOAuth = null)
                store.save(linked); initialSettings = linked
                mutable.update { it.copy(accountEmail = account.user.email, awaitingGoogle = false) }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { cancelGoogle(); report(e.message ?: "Could not finish Google sign-in. Please try again.") }
            finally { mutable.update { it.copy(authBusy = false) } }
        }
    }
    private fun clearAccount(message: String? = null) {
        stop()
        val cleared = initialSettings.copy(accountToken = "", accountEmail = "", accountExpiresAt = 0, accountProvider = "", pendingOAuth = null)
        initialSettings = cleared
        runCatching { store.save(cleared) }.onFailure { report("Could not clear saved credentials. Clear IRIS app storage in Android settings.") }
        mutable.update { it.copy(accountEmail = "", error = message ?: it.error) }
    }
    fun signOut() {
        if (state.value.authBusy) return
        val previous = initialSettings
        clearAccount()
        viewModelScope.launch(Dispatchers.IO) { runCatching { AccountClient(previous).use { it.logout() } } }
    }
    fun start(settings: RobotSettings) {
        if (session != null || state.value.authBusy) return
        mutable.update { it.copy(authBusy = true, error = null) }
        authJob = viewModelScope.launch {
            try {
                require(settings.hub == initialSettings.hub && settings.accountToken == initialSettings.accountToken) { "Sign in before starting IRIS" }
                val address = HubAddress.parse(settings.hub)
                val account = withContext(Dispatchers.IO) { AccountClient(settings).use { it.me() } }
                ensureActive()
                val verified = settings.copy(accountEmail = account.user.email, accountExpiresAt = account.expires_at_ms)
                store.save(verified); initialSettings = verified
                mutable.value = RobotUiState(running = true, accountEmail = account.user.email)
                session = RobotSession(getApplication(), verified, address,
                    { clearAccount("Your session ended. Continue with Google to sign in again.") },
                    { transform -> mutable.update(transform) })
                session!!.start()
            } catch (e: CancellationException) { throw e }
            catch (e: AccountExpired) { clearAccount(e.message) }
            catch (e: Exception) { stop(); report(e.message ?: "Could not start IRIS") }
            finally { mutable.update { it.copy(authBusy = false) } }
        }
    }
    fun stop() {
        session?.close(); session = null
        mutable.update { it.copy(running = false, hub = false, web = false, video = "idle", speaking = false,
            activeSpeech = false, listening = "Stopped", remoteTrack = null, frontendVideoLive = false, eglContext = null, enabled = false) }
    }
    fun background() {
        authJob?.cancel()
        if (session != null) { stop(); report("Session ended while IRIS was in the background.") }
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
    private val unauthorized: () -> Unit,
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
            if (!connected) { sessions?.bind(null); mqtt?.stopOutput(); rtc.peerAvailable(false); change { it.copy(web = false) } }
        }, ::message, settings.accountToken, unauthorized)
        listener = Listener(context, address, scope, hub::send, { label, active ->
            change { if (it.speaking || it.androidStt) it else it.copy(listening = label, activeSpeech = active) }
        }, ::error, settings.accountToken, unauthorized)
        recognizer = AndroidRecognizer(context, hub::send, { label, active ->
            change { if (it.speaking) it else it.copy(listening = label, activeSpeech = active) }
        }, ::error, listener::transcript)
        rtc = RtcClient(context, listener, hub::send, { value -> change { it.copy(video = value) } },
            { track -> change { it.copy(remoteTrack = track, frontendVideoLive = false, eglContext = if (track != null) rtc.egl.eglBaseContext else null) } },
            { live -> change { it.copy(frontendVideoLive = live) } }, ::error)
        speaker = Speaker(context, address, settings.accountToken, hub::send, {
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
            is PeerStatus -> {
                if (!msg.web) endDrivePair()
                rtc.peerAvailable(msg.web); change { it.copy(web = msg.web) }
            }
            is DriveBinding -> if (msg.device_id == controller.deviceId) sessions?.bind(msg.binding)
            is MediaReady -> if (msg.device_id == controller.deviceId &&
                (msg.control_session_id == null || controller.sessionId == null || msg.control_session_id == controller.sessionId)) {
                rtc.requestOffer()
            }
            is Speak -> speaker.speak(msg)
            is Listen -> if (!speaking && sttReady) {
                if (androidStt) recognizer.capture(msg.action, msg.request_id) else listener.capture(msg.action, msg.request_id)
            } else hub.send(SpeechState("failed", msg.request_id))
            is RtcAnswer, is RtcIce -> rtc.accept(msg)
            is Stop -> mqtt?.stop("Hub requested stop")
            is SessionRevoked -> if (msg.device_id == controller.deviceId) endDrivePair()
            is HubError -> error(msg.message)
            else -> Unit
        }
    }
    private fun endDrivePair() {
        sessions?.bind(null)
        if (controller.sessionId != null) {
            controller.revoke("Console disconnected or session revoked")
            mqtt?.stopOutput()
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
