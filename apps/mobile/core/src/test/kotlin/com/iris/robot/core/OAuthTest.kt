package com.iris.robot.core

import kotlinx.serialization.encodeToString
import kotlin.test.*
import org.junit.Test

class OAuthTest {
    private val attempt = OAuthAttempt("s".repeat(43), "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", 1000)
    private val callback = "com.iris.robot://oauth/callback?state=${attempt.state}&code=${"c".repeat(43)}"

    @Test fun pkceMatchesRfc7636Vector() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", attempt.challenge)
    }
    @Test fun acceptsOnlyTheInitiatingAppsState() {
        assertEquals(OAuthResult.Success("c".repeat(43)), attempt.callback(callback, 2000))
        assertFailsWith<IllegalArgumentException> { attempt.callback(callback.replace(attempt.state, "x".repeat(43)), 2000) }
    }
    @Test fun validatesTheExactReturnUriAndRejectsAmbiguousParameters() {
        for (raw in listOf(callback.replace("com.iris.robot:", "https:"), callback.replace("/callback?", "/other?"),
            callback.replace("//oauth/", "//evil/"), "$callback&state=${attempt.state}", "$callback#fragment", "$callback&error=access_denied")) {
            assertFailsWith<IllegalArgumentException>(raw) { attempt.callback(raw, 2000) }
        }
    }
    @Test fun expiredAndFutureAttemptsAreRejected() {
        assertFailsWith<IllegalArgumentException> { attempt.callback(callback, 999) }
        assertFailsWith<IllegalArgumentException> { attempt.callback(callback, 301001) }
    }
    @Test fun cancellationNeverReturnsAnExchangeCode() {
        assertEquals(OAuthResult.Failed("Google sign-in was canceled."), attempt.callback("com.iris.robot://oauth/callback?state=${attempt.state}&error=access_denied", 2000))
    }
    @Test fun aSavedAttemptSurvivesProcessRecreationWithoutLosingItsVerifier() {
        val restored = Protocol.json.decodeFromString<OAuthAttempt>(Protocol.json.encodeToString(attempt))
        assertEquals(attempt.challenge, restored.challenge)
        assertEquals(OAuthResult.Success("c".repeat(43)), restored.callback(callback, 2000))
    }
    @Test fun newAttemptsHaveIndependentUnpredictableStateAndVerifiers() {
        val one = OAuthAttempt.create(1000)
        val two = OAuthAttempt.create(1000)
        assertEquals(43, one.state.length)
        assertEquals(43, one.verifier.length)
        assertNotEquals(one.state, one.verifier)
        assertNotEquals(one.state, two.state)
        assertNotEquals(one.challenge, two.challenge)
    }
}
