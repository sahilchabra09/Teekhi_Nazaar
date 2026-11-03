package com.iris.robot.core

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

object Wav {
    fun encode(pcm: ByteArray, sampleRate: Int = 16000): ByteArray {
        require(pcm.size % 2 == 0 && sampleRate > 0)
        return ByteBuffer.allocate(44 + pcm.size).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + pcm.size); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(sampleRate); putInt(sampleRate * 2)
            putShort(2); putShort(16); put("data".toByteArray()); putInt(pcm.size); put(pcm)
        }.array()
    }
}

/** Streaming box-filter downsampler; preserves partial input groups across callbacks. */
class PcmResampler {
    private var rate = 0
    private var phase = 0
    private var sum = 0L
    private var count = 0
    fun reset() { rate = 0; phase = 0; sum = 0; count = 0 }
    fun convert(bytes: ByteArray, sampleRate: Int, channels: Int): ByteArray {
        require(sampleRate >= 16000 && channels in 1..8)
        if (rate != sampleRate) { reset(); rate = sampleRate }
        val out = ByteArrayOutputStream()
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        while (buffer.remaining() >= 2 * channels) {
            var mono = 0
            repeat(channels) { mono += buffer.short.toInt() }
            sum += mono / channels; count++
            phase += 16000
            if (phase >= sampleRate) {
                val sample = (sum / count).toInt()
                out.write(sample and 255); out.write((sample shr 8) and 255)
                phase -= sampleRate; sum = 0; count = 0
            }
        }
        return out.toByteArray()
    }
}

/** Receives exactly 512 mono samples per frame (32 ms). No Android or networking dependencies. */
class UtteranceSegmenter(private val activity: (Boolean) -> Unit, private val clip: (ByteArray) -> Unit) {
    private val preRoll = ArrayDeque<ByteArray>()
    private var recording: ByteArrayOutputStream? = null
    private var speechMs = 0
    private var silenceMs = 0
    var manual = false; private set
    var active = false; private set

    fun frame(pcm: ByteArray, speech: Boolean) {
        require(pcm.size == 1024)
        if (recording == null) {
            preRoll.addLast(pcm.copyOf())
            while (preRoll.size > 16) preRoll.removeFirst()
            speechMs = if (speech) speechMs + 32 else 0
            if (speechMs >= 256) begin()
        } else {
            recording!!.write(pcm)
            silenceMs = if (speech || manual) 0 else silenceMs + 32
            if (silenceMs >= 704 || recording!!.size() >= 16000 * 2 * 15) finish()
        }
    }
    fun toggleManual() {
        if (manual) { manual = false; finish() }
        else {
            if (recording != null) reset()
            manual = true; begin()
        }
    }
    private fun begin() {
        recording = ByteArrayOutputStream().also { out -> preRoll.forEach { out.write(it) } }
        preRoll.clear(); silenceMs = 0; active = true; activity(true)
    }
    private fun finish() {
        val bytes = recording?.toByteArray()
        reset()
        if (bytes != null && bytes.size >= 12800) clip(bytes.copyOf(minOf(bytes.size, 480000)))
    }
    fun reset() {
        recording = null; preRoll.clear(); speechMs = 0; silenceMs = 0; manual = false
        if (active) { active = false; activity(false) }
    }
}
