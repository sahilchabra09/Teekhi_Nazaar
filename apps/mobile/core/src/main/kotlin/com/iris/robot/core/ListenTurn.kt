package com.iris.robot.core

enum class ListenPhase { IDLE, PENDING, CAPTURING, FINISHING }

/** One foreground phone session, driven on the main thread using monotonic time. */
class ListenTurn {
    var phase = ListenPhase.IDLE
        private set
    var id: String? = null
        private set
    var deadline = 0L
        private set
    private var approvedUntil = 0L

    fun request(id: String, now: Long): Boolean {
        if (phase != ListenPhase.IDLE || id.isBlank()) return false
        this.id = id
        phase = ListenPhase.PENDING
        deadline = now + 60_000
        return true
    }

    fun approve(id: String, now: Long): Boolean {
        if (phase != ListenPhase.PENDING || this.id != id || now >= deadline) return false
        phase = ListenPhase.CAPTURING
        deadline = now + 30_000
        approvedUntil = now + 100_000
        return true
    }

    fun finishCapture(id: String): Boolean {
        if (phase != ListenPhase.CAPTURING || this.id != id) return false
        phase = ListenPhase.FINISHING
        deadline = approvedUntil
        return true
    }

    fun clear(id: String): Boolean {
        if (this.id != id) return false
        this.id = null
        phase = ListenPhase.IDLE
        deadline = 0
        approvedUntil = 0
        return true
    }
}
