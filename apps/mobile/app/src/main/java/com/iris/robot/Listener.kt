package com.iris.robot

import android.annotation.SuppressLint
import android.content.Context
import android.media.*
import android.os.SystemClock
import com.iris.robot.core.*
import com.konovalov.vad.silero.VadSilero
import com.konovalov.vad.silero.config.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class Listener(
    context: Context,
    private val address: HubAddress,
    private val scope: CoroutineScope,
    private val send: (Msg) -> Boolean,
    private val status: (String, Boolean) -> Unit,
    private val error: (String) -> Unit,
    private val accountToken: String,
) : AutoCloseable {
    private data class Samples(val bytes: ByteArray, val rate: Int, val channels: Int, val epoch: Int)
    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "iris-vad") }
    private val dispatcher = executor.asCoroutineDispatcher()
    private val audioScope = CoroutineScope(SupervisorJob() + dispatcher)
    private val samples = Channel<Samples>(8)
    private val resampler = PcmResampler()
    private val pending = ByteArrayOutputStream()
    private var vad: VadSilero? = null
    private var segmenter = UtteranceSegmenter(
        { active -> send(SpeechActivity(active)); status(if (active) "Someone is speaking" else "Listening", active) },
        ::upload,
    )
    @Volatile private var pausedUntil = 0L
    @Volatile private var enabled = true
    @Volatile private var closed = false
    @Volatile private var epoch = 0
    private var recorder: AudioRecord? = null
    private var recordingThread: Thread? = null
    @Volatile private var recording = false
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
    private val appContext = context.applicationContext
    private val uploads = kotlinx.coroutines.sync.Semaphore(2)

    init {
        audioScope.launch {
            try {
                vad = VadSilero(appContext, SampleRate.SAMPLE_RATE_16K, FrameSize.FRAME_SIZE_512, Mode.NORMAL)
                status("Listening", false)
                for (chunk in samples) {
                    if (closed) break
                    if (chunk.epoch != epoch || !enabled || SystemClock.elapsedRealtime() < pausedUntil) continue
                    val pcm = resampler.convert(chunk.bytes, chunk.rate, chunk.channels)
                    pending.write(pcm)
                    val bytes = pending.toByteArray()
                    var offset = 0
                    while (offset + 1024 <= bytes.size) {
                        if (chunk.epoch != epoch || SystemClock.elapsedRealtime() < pausedUntil) break
                        val frame = bytes.copyOfRange(offset, offset + 1024)
                        segmenter.frame(frame, vad!!.isSpeech(frame))
                        offset += 1024
                    }
                    pending.reset()
                    if (offset < bytes.size) pending.write(bytes, offset, bytes.size - offset)
                }
            } catch (e: Exception) {
                if (!closed) error("Speech detection is unavailable. Turn on phone speech recognition in Settings.")
            } finally { vad?.close(); vad = null }
        }
    }
    fun onMicSamples(bytes: ByteArray, rate: Int, channels: Int) {
        if (!closed && enabled && SystemClock.elapsedRealtime() >= pausedUntil) {
            if (samples.trySend(Samples(bytes.copyOf(), rate, channels, epoch)).isFailure) {
                // Never splice across dropped audio; discard the partial utterance instead.
                resetAudio()
            }
        }
    }
    fun setEnabled(value: Boolean) { enabled = value; resetAudio() }
    fun pause() { pausedUntil = Long.MAX_VALUE; resetAudio(); status("Speaking; listening paused", false) }
    fun resumeAfter(delayMs: Long = 500) {
        pausedUntil = SystemClock.elapsedRealtime() + delayMs
        resetAudio()
        scope.launch { delay(delayMs); if (!closed && enabled && SystemClock.elapsedRealtime() >= pausedUntil) status("Listening", false) }
    }
    private fun resetAudio() {
        epoch++
        audioScope.launch { pending.reset(); resampler.reset(); segmenter.reset() }
    }
    fun tap() {
        if (closed || !enabled || SystemClock.elapsedRealtime() < pausedUntil) return
        audioScope.launch { segmenter.toggleManual() }
    }
    @SuppressLint("MissingPermission")
    @Synchronized fun startStandalone() {
        if (recording || closed || !enabled) return
        val min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) { error("Microphone unavailable"); return }
        val input = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, maxOf(min * 2, 4096))
        if (input.state != AudioRecord.STATE_INITIALIZED) { input.release(); error("Microphone unavailable"); return }
        try { input.startRecording() } catch (e: Exception) { input.release(); error("Microphone could not start"); return }
        recorder = input; recording = true
        recordingThread = Thread({
            val buffer = ByteArray(1024)
            try {
                while (recording) {
                    val n = input.read(buffer, 0, buffer.size)
                    if (n <= 0) {
                        if (recording && !closed) error("Microphone interrupted; restart IRIS")
                        break
                    }
                    onMicSamples(buffer.copyOf(n), 16000, 1)
                }
            } catch (_: Exception) { if (recording && !closed) error("Microphone interrupted; restart IRIS") }
        }, "iris-mic").also { it.start() }
    }
    @Synchronized fun stopStandalone() {
        recording = false
        runCatching { recorder?.stop() }
        recordingThread?.join(1500)
        recorder?.release(); recorder = null; recordingThread = null
        resetAudio()
    }
    private fun upload(pcm: ByteArray) {
        if (closed || !uploads.tryAcquire()) { error("Audio upload busy; try again"); return }
        val id = "u_${UUID.randomUUID()}"
        scope.launch(Dispatchers.IO) {
            try {
                val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("utterance_id", id)
                    .addFormDataPart("duration_ms", (pcm.size / 32).toString())
                    .addFormDataPart("audio", "$id.wav", Wav.encode(pcm).toRequestBody("audio/wav".toMediaType())).build()
                http.newCall(Request.Builder().url("${address.http}/api/utterance").header("Authorization", "Bearer $accountToken").post(body).build()).execute().use {
                    if (it.code != 202) error(if (it.code == 501) "Transcription is unavailable. Turn on phone speech recognition in Settings." else "Audio could not be sent (HTTP ${it.code}). Check your connection.")
                }
            } catch (e: Exception) { if (!closed) error("Audio upload failed; check hub connection") }
            finally { uploads.release() }
        }
    }
    override fun close() {
        closed = true; stopStandalone(); send(SpeechActivity(false))
        samples.close(); audioScope.cancel()
        // Coroutine finally closes Silero on its own thread before dispatcher shutdown.
        dispatcher.close(); http.dispatcher.cancelAll(); http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll()
    }
}
