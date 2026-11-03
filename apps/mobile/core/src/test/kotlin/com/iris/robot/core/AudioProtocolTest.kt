package com.iris.robot.core

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.test.*

class AudioProtocolTest {
    @Test fun `wire format uses the contract discriminator and tolerates future fields`() {
        assertTrue(Protocol.encode(Hello(ts = 42)).contains("\"type\":\"hello\""))
        assertEquals(Speak("s1", "Hello", "phrase", ts = 42), Protocol.decode("""{"type":"speak","speak_id":"s1","text":"Hello","source":"phrase","ts":42,"future":true}"""))
        assertNull(Protocol.decode("""{"type":"unknown","ts":42}"""))
        assertNull(Protocol.decode("not json"))
        assertEquals(MediaReady(ts = 42), Protocol.decode("""{"type":"media_ready","device_id":"esp12e_carbot","ts":42}"""))
        assertNull(Protocol.decode("""{"type":"speak","ts":42}"""))
    }
    @Test fun `hub addresses support secure hosts ports and IPv6 without leaking credentials`() {
        assertEquals("ws://192.168.1.5:3000/ws?role=phone", HubAddress.parse("192.168.1.5").websocket)
        assertEquals("https://hub.example", HubAddress.parse("wss://hub.example/ws").http)
        assertEquals("http://[::1]:3000", HubAddress.parse("[::1]:3000").http)
        assertFails { HubAddress.parse("https://user:secret@hub.example") }
        assertFails { HubAddress.parse("file:///etc/passwd") }
        assertFails { HubAddress.parse("host:70000") }
    }
    @Test fun `wav headers describe mono 16-bit PCM with exact sizes`() {
        val pcm = ByteArray(16000 * 2)
        val bytes = Wav.encode(pcm)
        val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(bytes.copyOfRange(0, 4)))
        assertEquals(32036, header.getInt(4)); assertEquals(16000, header.getInt(24))
        assertEquals(1, header.getShort(22).toInt()); assertEquals(16, header.getShort(34).toInt())
        assertEquals(32000, header.getInt(40)); assertEquals(32044, bytes.size)
    }
    @Test fun `stereo resampling preserves groups across callback boundaries`() {
        val pcm = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN)
        repeat(6) { pcm.putShort(1000); pcm.putShort(3000) }
        val resampler = PcmResampler()
        val first = resampler.convert(pcm.array().copyOfRange(0, 8), 48000, 2)
        val second = resampler.convert(pcm.array().copyOfRange(8, 24), 48000, 2)
        assertEquals(0, first.size); assertEquals(4, second.size)
        assertEquals(2000, ByteBuffer.wrap(second).order(ByteOrder.LITTLE_ENDIAN).short.toInt())
    }
    @Test fun `speech includes preroll ends after silence and reset drops self-hearing clips`() {
        val activity = mutableListOf<Boolean>(); val clips = mutableListOf<ByteArray>()
        val s = UtteranceSegmenter(activity::add, clips::add)
        repeat(20) { s.frame(ByteArray(1024) { 1 }, false) }
        repeat(8) { s.frame(ByteArray(1024) { 2 }, true) }
        assertTrue(s.active)
        repeat(22) { s.frame(ByteArray(1024), false) }
        assertEquals(listOf(true, false), activity); assertEquals(1, clips.size)
        assertEquals(38 * 1024, clips.single().size)
        repeat(8) { s.frame(ByteArray(1024), true) }; s.reset()
        assertEquals(1, clips.size); assertFalse(s.active)
    }
    @Test fun `manual recording rejects short clips and caps long ones at fifteen seconds`() {
        val clips = mutableListOf<ByteArray>(); val s = UtteranceSegmenter({}, clips::add)
        s.toggleManual(); repeat(4) { s.frame(ByteArray(1024), true) }; s.toggleManual()
        assertTrue(clips.isEmpty())
        s.toggleManual(); repeat(500) { s.frame(ByteArray(1024), false) }
        assertEquals(1, clips.size); assertEquals(480000, clips.single().size); assertFalse(s.active)
    }
}
