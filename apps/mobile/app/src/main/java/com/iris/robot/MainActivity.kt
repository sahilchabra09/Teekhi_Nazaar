package com.iris.robot

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.core.net.toUri

class MainActivity : ComponentActivity() {
    private val model: RobotViewModel by viewModels()
    private var pending: RobotSettings? = null
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val settings = pending; pending = null
        if (result.values.all { it } && granted() && settings != null) model.start(settings)
        else model.report("Allow camera and microphone access in Android settings to start a session.")
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.action == Intent.ACTION_VIEW) intent.data?.let { model.googleCallback(it.toString()) }
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.light(0xFFDCEBE4.toInt(), 0xFFDCEBE4.toInt()),
            navigationBarStyle = SystemBarStyle.light(0xFFDCEBE4.toInt(), 0xFFDCEBE4.toInt()))
        setContent {
            IrisTheme {
                val state by model.state.collectAsStateWithLifecycle()
                LaunchedEffect(state.authorizationUrl) {
                    state.authorizationUrl?.let { url ->
                        model.browserOpened()
                        try { startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addCategory(Intent.CATEGORY_BROWSABLE)) }
                        catch (_: Exception) { model.cancelGoogle(); model.report("Install a web browser to continue with Google.") }
                    }
                }
                LaunchedEffect(state.running) {
                    if (state.running) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                Surface(Modifier.fillMaxSize(), color = Clay.Mist) {
                    IrisApp(state, model.initialSettings, model, ::start)
                }
            }
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Intent.ACTION_VIEW) intent.data?.let { model.googleCallback(it.toString()) }
    }
    private fun granted() = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO).all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    private fun start(settings: RobotSettings) {
        if (granted()) model.start(settings)
        else { pending = settings; permissions.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)) }
    }
    override fun onPause() { model.background(); super.onPause() }
}
