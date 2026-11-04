package com.iris.robot.core

enum class ListenPhase { IDLE, PENDING, CONNECTED, STARTING, CAPTURING, PROCESSING }

/** Consent belongs to the call. A speech engine may only capture the particular utterance the hub acknowledged. */
class ListenCall {
    var phase = ListenPhase.IDLE
        private set
    var id: String? = null
        private set
    var utterance: String? = null
        private set
    var answerDeadline = 0L
        private set
    val approved get() = phase != ListenPhase.IDLE && phase != ListenPhase.PENDING

    fun accepts(message: Speak) = message.call_id == null || (approved && message.call_id == id)

    fun request(id: String, now: Long): Boolean {
        if (phase != ListenPhase.IDLE || id.isBlank()) return false
        this.id = id
        utterance = id
        phase = ListenPhase.PENDING
        answerDeadline = now + 60_000
        return true
    }

    fun start(callId: String, utteranceId: String, now: Long): Boolean {
        if (callId != id || utteranceId != utterance) return false
        if (phase == ListenPhase.PENDING) {
            if (now >= answerDeadline) return false
        } else if (phase != ListenPhase.STARTING) return false
        phase = ListenPhase.CAPTURING
        return true
    }

    fun processing(utteranceId: String): Boolean {
        if (utteranceId != utterance || phase != ListenPhase.CAPTURING) return false
        phase = ListenPhase.PROCESSING
        return true
    }

    fun retire(utteranceId: String): Boolean {
        if (!approved || utteranceId != utterance) return false
        utterance = null
        phase = ListenPhase.CONNECTED
        return true
    }

    fun next(utteranceId: String): Boolean {
        if (phase != ListenPhase.CONNECTED || utteranceId.isBlank() || utteranceId == id) return false
        utterance = utteranceId
        phase = ListenPhase.STARTING
        return true
    }

    fun end(callId: String): Boolean {
        if (callId != id) return false
        id = null
        utterance = null
        phase = ListenPhase.IDLE
        return true
    }
}
