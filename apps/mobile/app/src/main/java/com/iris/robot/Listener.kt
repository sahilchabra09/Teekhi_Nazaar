package com.iris.robot

import android.annotation.SuppressLint
import android.media.*
import com.iris.robot.core.PcmResampler
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/** Receives PCM from the call or a standalone recorder only for the current approved utterance. */
class Listener(
    private val cloud: CloudSpeech,
    private val failed: (String, String) -> Unit,
) : AutoCloseable {
    private class Capture(val id: String) {
        val resampler = PcmResampler()
        val pending = ByteArrayOutputStream()
    }
    private data class Samples(val turn: Capture, val bytes: ByteArray, val rate: Int, val channels: Int)
    private val dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val audioScope = CoroutineScope(SupervisorJob() + dispatcher)
    private val samples = Channel<Samples>(8)
    @Volatile private var capture: Capture? = null
    @Volatile private var standalone = true
    @Volatile private var recorder: AudioRecord? = null
    private var recordingThread: Thread? = null

    init {
        audioScope.launch {
            for ((turn, bytes, rate, channels) in samples) {
                if (!current(turn)) continue
                try {
                    val pcm = turn.resampler.convert(bytes, rate, channels)
                    var offset = 0
                    while (offset < pcm.size && current(turn)) {
                        val count = minOf(1024 - turn.pending.size(), pcm.size - offset)
                        turn.pending.write(pcm, offset, count)
                        offset += count
                        if (turn.pending.size() == 1024) {
                            cloud.audio(turn.id, turn.pending.toByteArray())
                            turn.pending.reset()
                        }
                    }
                } catch (_: Exception) { failed(turn.id, "Could not process microphone audio") }
            }
        }
    }

    private fun current(turn: Capture) = capture === turn

    private fun enqueue(turn: Capture, bytes: ByteArray, count: Int, rate: Int, channels: Int) {
        if (current(turn) && samples.trySend(Samples(turn, bytes.copyOf(count), rate, channels)).isFailure)
            failed(turn.id, "Microphone audio could not keep up")
    }

    fun onMicSamples(bytes: ByteArray, rate: Int, channels: Int) {
        val turn = capture ?: return
        if (!standalone) enqueue(turn, bytes, bytes.size, rate, channels)
    }

    @Synchronized fun start(callId: String, id: String) {
        if (capture != null) return
        cloud.start(callId, id)
        val turn = Capture(id)
        capture = turn
        if (standalone) openRecorder(turn)
    }

    /** The RTC thread declares the source it owns. Selecting a source never grants consent. */
    @Synchronized fun setStandalone(value: Boolean) {
        standalone = value
        val turn = capture
        if (value && turn != null && current(turn)) openRecorder(turn) else closeRecorder()
    }

    @SuppressLint("MissingPermission")
    private fun openRecorder(turn: Capture) {
        if (recorder != null) return
        var input: AudioRecord? = null
        try {
            val min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            check(min > 0)
            val mic = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, maxOf(min * 2, 4096))
            input = mic
            check(mic.state == AudioRecord.STATE_INITIALIZED)
            mic.startRecording()
            recorder = mic
            recordingThread = Thread({
                val buffer = ByteArray(1024)
                try {
                    while (recorder === mic && current(turn)) {
                        val count = mic.read(buffer, 0, buffer.size)
                        check(count > 0)
                        if (recorder === mic) enqueue(turn, buffer, count, 16000, 1)
                    }
                } catch (_: Exception) { if (recorder === mic && current(turn)) failed(turn.id, "Microphone interrupted") }
            }, "iris-mic").also { it.start() }
        } catch (_: Exception) {
            input?.release()
            failed(turn.id, "Microphone could not start")
        }
    }

    private fun closeRecorder() {
        val mic = recorder ?: return
        recorder = null
        runCatching { mic.stop() }
        recordingThread?.join(1500)
        mic.release()
        recordingThread = null
    }

    @Synchronized fun stop(id: String) {
        if (capture?.id != id) return
        capture = null
        cloud.stop(id)
        closeRecorder()
    }

    @Synchronized fun end(id: String) {
        if (capture?.id == id) capture = null
        cloud.end(id)
        closeRecorder()
    }

    @Synchronized override fun close() {
        capture = null
        closeRecorder()
        samples.close()
        audioScope.cancel()
        dispatcher.close()
    }
}
