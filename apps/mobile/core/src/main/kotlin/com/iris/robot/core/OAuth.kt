package com.iris.robot.core

import kotlinx.serialization.Serializable
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

@Serializable data class OAuthAttempt(val state: String, val verifier: String, val createdAtMs: Long) {
    val challenge: String get() = Base64.getUrlEncoder().withoutPadding()
        .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(StandardCharsets.US_ASCII)))
    fun callback(raw: String, nowMs: Long): OAuthResult {
        require(nowMs >= createdAtMs && nowMs - createdAtMs <= 5 * 60_000) { "Google sign-in expired. Please try again." }
        val uri = URI(raw)
        require(uri.scheme == "com.iris.robot" && uri.host == "oauth" && uri.path == "/callback" && uri.userInfo == null && uri.port == -1 && uri.fragment == null) { "Invalid sign-in return link" }
        val pairs = (uri.rawQuery ?: "").split('&').map {
            val parts = it.split('=', limit = 2)
            URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
        }
        require(pairs.map { it.first }.distinct().size == pairs.size) { "Invalid sign-in return link" }
        val params = pairs.toMap()
        require(MessageDigest.isEqual(state.toByteArray(StandardCharsets.US_ASCII), params["state"].orEmpty().toByteArray(StandardCharsets.US_ASCII))) { "This sign-in was not started by IRIS. Please try again." }
        val code = params["code"]
        val error = params["error"]
        require((code == null) != (error == null)) { "Invalid sign-in return link" }
        if (error != null) return OAuthResult.Failed(if (error == "access_denied") "Google sign-in was canceled." else "Google sign-in could not finish. Please try again.")
        require(code!!.matches(Regex("[A-Za-z0-9_-]{43}"))) { "Invalid sign-in response" }
        return OAuthResult.Success(code)
    }
    companion object {
        fun create(nowMs: Long = System.currentTimeMillis()): OAuthAttempt {
            val random = SecureRandom()
            fun secret() = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { random.nextBytes(it) })
            return OAuthAttempt(secret(), secret(), nowMs)
        }
    }
}

sealed interface OAuthResult {
    data class Success(val code: String) : OAuthResult
    data class Failed(val message: String) : OAuthResult
}
