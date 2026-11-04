package com.iris.robot

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.*

/** Each approval owns a fresh listener, so callbacks from a cancelled turn cannot submit to its successor. */
class AndroidRecognizer(
    private val context: Context,
    private val finishedSpeaking: (String) -> Unit,
    private val result: (String, String, Double?) -> Unit,
    private val failed: (String, String) -> Unit,
) : AutoCloseable {
    private var recognizer: SpeechRecognizer? = null
    private var activeId: String? = null

    fun start(id: String) {
        if (activeId != null) return
        activeId = id
        try {
            check(SpeechRecognizer.isRecognitionAvailable(context)) { "No Android speech recognition service is installed" }
            val service = SpeechRecognizer.createSpeechRecognizer(context)
            recognizer = service
            service.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle) {
                    if (activeId != id) return
                    val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                    val confidence = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)?.firstOrNull()?.takeIf { it in 0f..1f }?.toDouble()
                    close()
                    result(id, text, confidence)
                }
                override fun onError(error: Int) {
                    if (activeId != id) return
                    close()
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) result(id, "", null)
                    else failed(id, "Android speech recognition error $error")
                }
                override fun onEndOfSpeech() { if (activeId == id) finishedSpeaking(id) }
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            service.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            })
        } catch (e: Exception) { close(); failed(id, e.message ?: "Android speech recognition could not start") }
    }

    fun stop(id: String) { if (activeId == id) recognizer?.stopListening() }

    override fun close() {
        activeId = null
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
    }
}
