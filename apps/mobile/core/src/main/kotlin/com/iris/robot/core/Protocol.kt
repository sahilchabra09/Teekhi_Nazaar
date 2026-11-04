package com.iris.robot.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.URI
import java.time.Instant

object Protocol {
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
    fun encode(message: Msg): String = json.encodeToString(message)
    fun decode(raw: String): Msg? = runCatching { json.decodeFromString<Msg>(raw) }.getOrNull()
}

@Serializable sealed interface Msg { val ts: Long }
@Serializable @SerialName("hello")
data class Hello(val role: String = "phone", val version: Int = 1, override val ts: Long = System.currentTimeMillis(), val drive_proof: String = "hmac-sha256-v1") : Msg
@Serializable @SerialName("peer_status")
data class PeerStatus(val web: Boolean, val phone: Boolean, val robot: Boolean, override val ts: Long) : Msg
@Serializable @SerialName("speak")
data class Speak(val speak_id: String, val text: String, val source: String, val audio_url: String? = null, override val ts: Long, val call_id: String? = null) : Msg
@Serializable @SerialName("tts_status")
data class TtsStatus(val speak_id: String, val state: String, val error: String? = null, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("speech_activity")
data class SpeechActivity(val active: Boolean, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("transcript")
data class Transcript(val utterance_id: String, val text: String, val confidence: Double? = null, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("listen")
data class Listen(val action: String, val request_id: String, override val ts: Long, val call_id: String? = null, val continuous: Boolean? = null) : Msg
@Serializable @SerialName("speech_state")
data class SpeechState(val state: String, val request_id: String, override val ts: Long = System.currentTimeMillis(), val call_id: String? = null) : Msg
@Serializable @SerialName("motion")
data class MotionMessage(val alpha: Double, val beta: Double, val gamma: Double, val accel: Double, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("bump")
data class Bump(val kind: String, val magnitude: Double, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("stop")
data class Stop(val reason: String, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("rtc_offer")
data class RtcOffer(val sdp: String, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("media_ready")
data class MediaReady(val device_id: String = "esp12e_carbot", val control_session_id: String? = null, override val ts: Long) : Msg
@Serializable @SerialName("rtc_answer")
data class RtcAnswer(val sdp: String, override val ts: Long) : Msg
@Serializable data class IceCandidateData(val candidate: String, val sdpMid: String? = null, val sdpMLineIndex: Int? = null, val usernameFragment: String? = null)
@Serializable @SerialName("rtc_ice")
data class RtcIce(val candidate: IceCandidateData, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("frame")
data class Frame(val jpeg_b64: String, val w: Int, val h: Int, override val ts: Long = System.currentTimeMillis()) : Msg
@Serializable @SerialName("error")
data class HubError(val code: String, val message: String, override val ts: Long) : Msg

data class HubAddress(val http: String, val websocket: String) {
    companion object {
        fun parse(input: String): HubAddress {
            val raw = input.trim()
            require(raw.isNotBlank()) { "Enter the laptop IP or hub URL" }
            val uri = URI(if ("://" in raw) raw else "http://$raw")
            require(uri.scheme in setOf("http", "https", "ws", "wss")) { "Use http, https, ws or wss" }
            require(!uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null) { "Enter a host and optional port, without credentials or query" }
            require(uri.path.isNullOrEmpty() || uri.path in setOf("/", "/ws")) { "Hub URL must point to / or /ws" }
            val secure = uri.scheme in setOf("https", "wss")
            val port = if (uri.port == -1 && "://" !in raw) 3000 else uri.port
            require(port == -1 || port in 1..65535) { "Invalid port" }
            val base = URI(if (secure) "https" else "http", null, uri.host, port, null, null, null).toString()
            val ws = URI(if (secure) "wss" else "ws", null, uri.host, port, "/ws", "role=phone", null).toString()
            return HubAddress(base, ws)
        }
    }
}

@Serializable data class DriveIntent(
    val type: String,
    val device_id: String,
    val control_session_id: String,
    val command_id: String,
    val seq: Long,
    val action: String,
    val speed: Int,
    val sent_at: String,
    val ttl_ms: Int,
    val signature: String = "",
) {
    fun sentAtMs(): Long? = runCatching { Instant.parse(sent_at).toEpochMilli() }.getOrNull()
}

/** HTTP-only contract, returned by an authenticated backend; never accepted over MQTT. */
@Serializable data class SessionGrant(
    val device_id: String,
    val control_session_id: String,
    val server_time_ms: Long,
    val expires_at_ms: Long,
    val max_ttl_ms: Int = 300,
    val signing_key: String,
)
@Serializable @SerialName("drive_binding")
data class DriveBinding(val device_id: String, val binding: String, override val ts: Long) : Msg
@Serializable @SerialName("session_revoked")
data class SessionRevoked(val device_id: String, val control_session_id: String, override val ts: Long) : Msg

@Serializable data class EspStatus(
    val device_id: String,
    val status: String,
    val left_speed: Int? = null,
    val right_speed: Int? = null,
    val phone_control_active: Boolean? = null,
    val servo_angle: Int? = null,
    val uptime: Long? = null,
)
@Serializable data class ServoCommand(val password: String, val servo: Int)
@Serializable data class WheelCommand(
    val password: String,
    val left: Int,
    val right: Int,
    val armed: Boolean,
    val cmd: String,
    val source: String = "lain-mobile",
    val device_id: String = "esp12e_carbot",
    val phone_control: Boolean = true,
    val pitch_deg: Double = 0.0,
    val roll_deg: Double = 0.0,
    val yaw_deg: Double = 0.0,
)
@Serializable data class MobileStatus(
    val device_id: String = "esp12e_carbot",
    val control_session_id: String? = null,
    val last_command_id: String? = null,
    val state: String,
    val reason: String,
    val esp_online: Boolean,
    val calibrated: Boolean,
    val heading_deg: Double,
    val target_heading_deg: Double,
    val left: Int,
    val right: Int,
    val type: String = "mobile_status",
    val supports_neutral: Boolean = true,
)
