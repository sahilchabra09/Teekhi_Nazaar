package com.iris.robot.core

import kotlin.test.*

class ListenTurnTest {
    private val turn = ListenTurn()

    @Test fun `only the pending local request can start a single turn`() {
        assertFalse(turn.approve("unexpected", 5))
        assertTrue(turn.request("first", 5))
        assertFalse(turn.request("replacement", 6))
        assertFalse(turn.approve("wrong", 7))
        assertTrue(turn.approve("first", 8))
        assertFalse(turn.approve("first", 9))
        assertFalse(turn.finishCapture("wrong"))
        assertTrue(turn.finishCapture("first"))
        assertFalse(turn.finishCapture("first"))
        assertEquals(ListenPhase.FINISHING, turn.phase)
        assertTrue(turn.clear("first"))
        assertFalse(turn.approve("first", 10))
    }

    @Test fun `consent expires and cannot replay across cancel or a new turn`() {
        turn.request("first", 0)
        assertFalse(turn.approve("first", 60_000))
        turn.clear("first")
        turn.request("second", 61_000)
        assertFalse(turn.clear("first"))
        assertTrue(turn.approve("second", 62_000))
        assertEquals(92_000L, turn.deadline)
        turn.finishCapture("second")
        assertEquals(162_000L, turn.deadline)
        turn.clear("second")
        assertEquals(ListenPhase.IDLE, turn.phase)
        assertFalse(turn.finishCapture("second"))
    }
}
