package com.iris.robot.core

import kotlin.test.*

class ListenCallTest {
    private val call = ListenCall()

    @Test fun `one matching timely answer authorizes subsequent distinct utterances until the patient ends the call`() {
        assertFalse(call.start("stranger", "stranger", 0))
        assertTrue(call.request("A", 0))
        assertFalse(call.request("replacement", 0))
        assertFalse(call.start("A", "wrong turn", 0))
        assertTrue(call.start("A", "A", 59_999))
        assertFalse(call.start("A", "A", 60_000))
        assertTrue(call.processing("A"))
        assertTrue(call.retire("A"))
        assertTrue(call.approved)
        assertFalse(call.start("A", "new", 86400_000))
        assertTrue(call.next("new"))
        assertFalse(call.start("other", "new", 86400_000))
        assertTrue(call.start("A", "new", 86400_000))
        assertFalse(call.retire("A"))
        assertFalse(call.end("new"))
        assertTrue(call.end("A"))
        assertFalse(call.next("again"))
        assertFalse(call.start("A", "new", 86400_001))
    }

    @Test fun `a paused in-flight next cannot reopen the mic during playback or after replacement`() {
        call.request("A", 0)
        call.start("A", "A", 1)
        call.retire("A")
        call.next("B")
        assertTrue(call.retire("B"))
        assertFalse(call.start("A", "B", 2))
        call.next("C")
        assertFalse(call.retire("B"))
        assertTrue(call.start("A", "C", 3))
        call.end("A")
        call.request("D", 4)
        assertFalse(call.start("A", "C", 5))
        assertFalse(call.start("D", "D", 60_004))
    }

    @Test fun `an ended call cannot play a queued or late reply in the next call`() {
        val ordinary = Speak("s1", "Hello", "phrase", ts = 42)
        val reply = ordinary.copy(speak_id = "s2", call_id = "first")
        assertEquals(reply, Protocol.decode(Protocol.encode(reply)))
        assertTrue(call.accepts(ordinary))
        assertFalse(call.accepts(reply))
        call.request("first", 0)
        assertFalse(call.accepts(reply))
        call.start("first", "first", 1)
        assertTrue(call.accepts(reply))
        call.end("first")
        call.request("second", 2)
        call.start("second", "second", 3)
        assertFalse(call.accepts(reply))
        assertTrue(call.accepts(ordinary))
    }

    @Test fun `continuous controls and speech states preserve both identifiers`() {
        val request = Listen("next", "utterance", 42, call_id = "call", continuous = true)
        assertEquals(request, Protocol.decode(Protocol.encode(request)))
        assertEquals(SpeechState("ready", "utterance", 42, call_id = "call"), Protocol.decode(
            """{"type":"speech_state","state":"ready","request_id":"utterance","call_id":"call","ts":42}"""))
        assertNull((Protocol.decode("""{"type":"listen","action":"start","request_id":"old","ts":42}""") as Listen).continuous)
    }
}
