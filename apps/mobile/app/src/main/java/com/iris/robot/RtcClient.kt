package com.iris.robot

import android.content.Context
import android.graphics.*
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Base64
import com.iris.robot.core.*
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class RtcClient(
    private val context: Context,
    private val listener: Listener,
    private val send: (Msg) -> Boolean,
    private val state: (String) -> Unit,
    private val remote: (VideoTrack?) -> Unit,
    private val remoteLive: (Boolean) -> Unit,
    private val error: (String) -> Unit,
) : AutoCloseable {
    val egl = EglBase.create()
    private val thread = HandlerThread("iris-rtc").apply { start() }
    private val handler = Handler(thread.looper)
    private val jpegExecutor = Executors.newSingleThreadExecutor()
    private val encoding = AtomicBoolean(false)
    private var lastFrameAt = 0L
    private var factory: PeerConnectionFactory? = null
    private var adm: JavaAudioDeviceModule? = null
    private var helper: SurfaceTextureHelper? = null
    private var capturer: VideoCapturer? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var video: VideoTrack? = null
    private var audio: AudioTrack? = null
    private var peer: PeerConnection? = null
    private var inboundVideo: VideoTrack? = null
    private var inboundMonitor: VideoSink? = null
    private var remoteDescriptionSet = false
    private val ice = mutableListOf<IceCandidate>()
    private var web = false
    private var forceJpeg = false
    private var recognition = false
    @Volatile private var fallback = false
    @Volatile private var webAvailable = false
    @Volatile private var closed = false
    private var epoch = 0
    private var microphoneApproved = false

    /** Apply immediately, including to the current peer while the RTC handler is busy. */
    @Synchronized fun approveMicrophone(value: Boolean) {
        microphoneApproved = value && !closed
        adm?.setMicrophoneMute(!microphoneApproved)
        audio?.setEnabled(microphoneApproved)
        peer?.setAudioRecording(microphoneApproved)
    }

    fun start() { handler.post {
        try {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
            val module = JavaAudioDeviceModule.builder(context)
                .setUseHardwareAcousticEchoCanceler(true).setUseHardwareNoiseSuppressor(true)
                .setSamplesReadyCallback { s -> listener.onMicSamples(s.data, s.sampleRate, s.channelCount) }
                .createAudioDeviceModule()
            synchronized(this) {
                module.setMicrophoneMute(!microphoneApproved)
                adm = module
            }
            factory = PeerConnectionFactory.builder().setAudioDeviceModule(adm)
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext)).createPeerConnectionFactory()
            val enumerator = Camera2Enumerator(context)
            val name = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
                ?: enumerator.deviceNames.firstOrNull() ?: throw IllegalStateException("No camera available")
            capturer = enumerator.createCapturer(name, null) ?: throw IllegalStateException("Camera could not start")
            helper = SurfaceTextureHelper.create("iris-camera", egl.eglBaseContext)
            videoSource = factory!!.createVideoSource(false)
            capturer!!.initialize(helper, context, videoSource!!.capturerObserver)
            video = factory!!.createVideoTrack("iris-video", videoSource).also { it.addSink(jpegSink) }
            audioSource = factory!!.createAudioSource(MediaConstraints())
            synchronized(this) {
                audio = factory!!.createAudioTrack("iris-audio", audioSource).also { it.setEnabled(microphoneApproved) }
            }
            capturer!!.startCapture(640, 480, 24)
            listener.setStandalone(true)
            state("idle")
            if (web) startPeer()
        } catch (e: Exception) { listener.setStandalone(true); state("failed"); error("Camera/WebRTC setup failed: ${e.message}") }
    } }
    fun peerAvailable(value: Boolean) { handler.post {
        if (closed) return@post
        webAvailable = value
        if (web == value) return@post
        web = value
        closePeer()
        if (web && factory != null) startPeer() else {
            if (!recognition) listener.setStandalone(true)
            state(if (fallback) "fallback" else "idle")
        }
    } }
    fun setModes(jpeg: Boolean, androidStt: Boolean, ready: () -> Unit = {}) { handler.post {
        forceJpeg = jpeg; recognition = androidStt; fallback = jpeg || androidStt
        closePeer()
        if (recognition) listener.setStandalone(false)
        if (web && factory != null) startPeer()
        else { if (!recognition) listener.setStandalone(true); state(if (fallback) "fallback" else "idle") }
        ready()
    } }
    fun requestOffer() { handler.post {
        if (closed) return@post
        web = true; webAvailable = true
        closePeer()
        if (factory != null) startPeer()
    } }
    private fun startPeer() {
        if (closed || !web || factory == null) return
        if (forceJpeg || recognition || fallback) {
            fallback = true
            if (!recognition) listener.setStandalone(true)
            state("fallback"); return
        }
        // AudioRecord has fully stopped and released before WebRTC is allowed to own the mic.
        listener.setStandalone(false)
        closePeer()
        val generation = ++epoch
        state("connecting")
        val config = PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        val connection = factory!!.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) { handler.post {
                if (epoch == generation) send(RtcIce(IceCandidateData(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)))
            } }
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) { handler.post {
                if (generation != epoch || closed) return@post
                when (newState) {
                    PeerConnection.PeerConnectionState.CONNECTED -> state("live")
                    PeerConnection.PeerConnectionState.FAILED -> useFallback("WebRTC failed; JPEG video enabled")
                    PeerConnection.PeerConnectionState.DISCONNECTED -> {
                        state("connecting")
                        handler.postDelayed({ if (generation == epoch && peer?.connectionState() == PeerConnection.PeerConnectionState.DISCONNECTED) useFallback("WebRTC disconnected; JPEG video enabled") }, 5000)
                    }
                    else -> Unit
                }
            } }
            override fun onTrack(transceiver: RtpTransceiver) { handler.post {
                if (generation == epoch) (transceiver.receiver.track() as? VideoTrack)?.let { attachFrontendVideo(it, generation) }
            } }
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) { handler.post {
                if (generation == epoch) (receiver.track() as? VideoTrack)?.let { attachFrontendVideo(it, generation) }
            } }
            override fun onSignalingChange(s: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) = Unit
            override fun onIceConnectionReceivingChange(v: Boolean) = Unit
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) = Unit
            override fun onAddStream(s: MediaStream) = Unit
            override fun onRemoveStream(s: MediaStream) = Unit
            override fun onDataChannel(c: DataChannel) = Unit
            override fun onRenegotiationNeeded() = Unit
        }) ?: run { useFallback("Could not create WebRTC connection"); return }
        synchronized(this) {
            connection.setAudioRecording(microphoneApproved)
            peer = connection
        }
        connection.addTrack(video, listOf("iris"))
        connection.addTrack(audio, listOf("iris"))
        // Reserve a receive direction for the optional patient video in the browser's answer.
        connection.transceivers.firstOrNull { it.mediaType == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO }?.direction = RtpTransceiver.RtpTransceiverDirection.SEND_RECV
        connection.createOffer(sdpObserver(generation, onCreate = { sdp ->
            connection.setLocalDescription(sdpObserver(generation, onSet = { send(RtcOffer(sdp.description)) }), sdp)
        }), MediaConstraints())
        handler.postDelayed({ if (epoch == generation && connection.connectionState() != PeerConnection.PeerConnectionState.CONNECTED) useFallback("WebRTC timed out; JPEG video enabled") }, 12_000)
    }
    private fun useFallback(message: String) {
        closePeer(); fallback = true
        if (!recognition) listener.setStandalone(true)
        state("fallback"); error(message)
    }
    fun accept(message: Msg) { handler.post {
        val connection = peer ?: return@post
        val generation = epoch
        when (message) {
            is RtcAnswer -> connection.setRemoteDescription(sdpObserver(generation, onSet = {
                remoteDescriptionSet = true; ice.forEach { connection.addIceCandidate(it) }; ice.clear()
            }), SessionDescription(SessionDescription.Type.ANSWER, message.sdp))
            is RtcIce -> {
                val c = message.candidate
                if (c.candidate.isBlank()) return@post
                val candidate = IceCandidate(c.sdpMid, c.sdpMLineIndex ?: 0, c.candidate)
                if (remoteDescriptionSet) connection.addIceCandidate(candidate) else if (ice.size < 128) ice.add(candidate)
            }
            else -> Unit
        }
    } }
    private fun sdpObserver(generation: Int, onCreate: (SessionDescription) -> Unit = {}, onSet: () -> Unit = {}) = object : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) { handler.post { if (epoch == generation) onCreate(sdp) } }
        override fun onSetSuccess() { handler.post { if (epoch == generation) onSet() } }
        override fun onCreateFailure(message: String) { handler.post { if (epoch == generation) useFallback("Video negotiation failed") } }
        override fun onSetFailure(message: String) { handler.post { if (epoch == generation) useFallback("Video negotiation failed") } }
    }
    private fun closePeer() {
        epoch++
        detachFrontendVideo()
        remote(null)
        val previous = synchronized(this) { peer.also { peer = null } }
        previous?.close(); previous?.dispose()
        remoteDescriptionSet = false; ice.clear()
    }
    private fun detachFrontendVideo() {
        val track = inboundVideo
        inboundMonitor?.let { monitor -> runCatching { track?.removeSink(monitor) } }
        inboundVideo = null; inboundMonitor = null
        remoteLive(false)
    }
    private fun attachFrontendVideo(track: VideoTrack, generation: Int) {
        if (inboundVideo?.id() == track.id()) return
        detachFrontendVideo()
        inboundVideo = track
        val lastFrame = AtomicLong(0)
        val monitor = VideoSink { lastFrame.set(SystemClock.elapsedRealtime()) }
        inboundMonitor = monitor
        track.addSink(monitor)
        remote(track)
        var wasLive = false
        val checkFrames = object : Runnable {
            override fun run() {
                if (closed || generation != epoch || inboundVideo !== track) return
                val at = lastFrame.get()
                val live = at > 0 && SystemClock.elapsedRealtime() - at < 2500
                if (live != wasLive) { wasLive = live; remoteLive(live) }
                handler.postDelayed(this, 500)
            }
        }
        handler.post(checkFrames)
    }
    private val jpegSink = VideoSink { frame ->
        val now = android.os.SystemClock.elapsedRealtime()
        if (!fallback || !webAvailable || closed || now - lastFrameAt < 150 || !encoding.compareAndSet(false, true)) return@VideoSink
        lastFrameAt = now
        frame.retain()
        try { jpegExecutor.execute {
            try {
                val buffer = frame.buffer.toI420() ?: return@execute
                try {
                    val w = buffer.width; val h = buffer.height
                    if (w % 2 != 0 || h % 2 != 0) return@execute
                    val nv21 = ByteArray(w * h * 3 / 2)
                    for (y in 0 until h) for (x in 0 until w) nv21[y * w + x] = buffer.dataY.get(y * buffer.strideY + x)
                    var offset = w * h
                    for (y in 0 until h / 2) for (x in 0 until w / 2) {
                        nv21[offset++] = buffer.dataV.get(y * buffer.strideV + x)
                        nv21[offset++] = buffer.dataU.get(y * buffer.strideU + x)
                    }
                    val out = ByteArrayOutputStream()
                    YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(Rect(0, 0, w, h), 60, out)
                    var jpeg = out.toByteArray(); var width = w; var height = h
                    if (frame.rotation != 0) {
                        val bitmap = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size)
                        val rotated = Bitmap.createBitmap(bitmap, 0, 0, w, h, Matrix().apply { postRotate(frame.rotation.toFloat()) }, true)
                        out.reset(); rotated.compress(Bitmap.CompressFormat.JPEG, 60, out)
                        jpeg = out.toByteArray(); width = rotated.width; height = rotated.height
                        if (rotated !== bitmap) rotated.recycle()
                        bitmap.recycle()
                    }
                    if (!closed) send(Frame(Base64.encodeToString(jpeg, Base64.NO_WRAP), width, height))
                } finally { buffer.release() }
            } catch (_: Exception) { /* A dropped fallback frame must not interrupt control. */ }
            finally { frame.release(); encoding.set(false) }
        } } catch (_: java.util.concurrent.RejectedExecutionException) { frame.release(); encoding.set(false) }
    }
    override fun close() {
        closed = true
        approveMicrophone(false)
        handler.post {
            closePeer()
            runCatching { capturer?.stopCapture() }; capturer?.dispose(); capturer = null
            video?.removeSink(jpegSink); video?.dispose()
            synchronized(this) { audio?.dispose(); audio = null }
            videoSource?.dispose(); audioSource?.dispose(); helper?.dispose()
            factory?.dispose(); synchronized(this) { adm?.release(); adm = null }
            jpegExecutor.shutdown()
            egl.release(); thread.quitSafely()
        }
    }
}
