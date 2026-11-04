package com.iris.robot

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

internal enum class Symbol { Settings, Camera, Laptop, Mic, Power, Speaker, Close, Check, Arrow, Chevron, User }

@Composable internal fun IrisSymbol(symbol: Symbol, modifier: Modifier = Modifier, tint: Color = Clay.Pine) {
    Canvas(modifier.size(24.dp)) {
        val s = size.minDimension / 24f
        val stroke = Stroke(1.7f * s, cap = StrokeCap.Round)
        fun point(x: Float, y: Float) = Offset(x * s, y * s)
        fun line(x: Float, y: Float, endX: Float, endY: Float) = drawLine(tint, point(x, y), point(endX, endY), strokeWidth = stroke.width, cap = StrokeCap.Round)
        fun circle(x: Float, y: Float, radius: Float) = drawCircle(tint, radius * s, point(x, y), style = stroke)
        fun roundRect(x: Float, y: Float, w: Float, h: Float, radius: Float) = drawRoundRect(tint, point(x, y), Size(w * s, h * s), CornerRadius(radius * s), style = stroke)
        when (symbol) {
            Symbol.Settings -> {
                circle(12f, 12f, 6.7f); circle(12f, 12f, 2.5f)
                repeat(8) { index ->
                    val angle = index * Math.PI / 4
                    line(12 + (cos(angle) * 7).toFloat(), 12 + (sin(angle) * 7).toFloat(),
                        12 + (cos(angle) * 9.5).toFloat(), 12 + (sin(angle) * 9.5).toFloat())
                }
            }
            Symbol.Camera -> {
                roundRect(3f, 7f, 18f, 13f, 3f); circle(12f, 13.5f, 3f)
                line(8f, 7f, 10f, 4f); line(10f, 4f, 14f, 4f); line(14f, 4f, 16f, 7f)
            }
            Symbol.Laptop -> { roundRect(4f, 4f, 16f, 12f, 2f); line(2f, 20f, 22f, 20f); line(12f, 16f, 12f, 20f) }
            Symbol.Mic -> {
                roundRect(9f, 3f, 6f, 11f, 3f)
                drawArc(tint, 0f, 180f, false, point(6f, 4f), Size(12 * s, 14 * s), style = stroke)
                line(12f, 18f, 12f, 22f); line(9f, 22f, 15f, 22f)
            }
            Symbol.Power -> {
                line(12f, 2.5f, 12f, 11f)
                drawArc(tint, -55f, 290f, false, point(3.5f, 4.5f), Size(17 * s, 17 * s), style = stroke)
            }
            Symbol.Speaker -> {
                val path = Path().apply { moveTo(3 * s, 10 * s); lineTo(7 * s, 10 * s); lineTo(12 * s, 5 * s); lineTo(12 * s, 19 * s); lineTo(7 * s, 14 * s); lineTo(3 * s, 14 * s); close() }
                drawPath(path, tint, style = stroke)
                drawArc(tint, -60f, 120f, false, point(12f, 5f), Size(9 * s, 14 * s), style = stroke)
            }
            Symbol.Close -> { line(6f, 6f, 18f, 18f); line(18f, 6f, 6f, 18f) }
            Symbol.Check -> { line(6f, 12f, 10f, 16f); line(10f, 16f, 18f, 8f) }
            Symbol.Arrow -> { line(5f, 12f, 19f, 12f); line(14f, 7f, 19f, 12f); line(19f, 12f, 14f, 17f) }
            Symbol.Chevron -> { line(9f, 6f, 15f, 12f); line(15f, 12f, 9f, 18f) }
            Symbol.User -> { circle(12f, 8f, 3.5f); roundRect(5f, 15f, 14f, 7f, 3f) }
        }
    }
}

@Composable internal fun IrisMark(modifier: Modifier = Modifier) {
    Canvas(modifier.size(32.dp)) {
        drawCircle(Clay.Teal, size.minDimension / 2)
        drawCircle(Clay.Honey, size.minDimension * .33f)
        drawCircle(Clay.Pine, size.minDimension * .2f)
        drawCircle(Color.White.copy(alpha = .85f), size.minDimension * .065f, Offset(size.width * .39f, size.height * .36f))
    }
}

@Composable internal fun IrisHeader(onSettings: () -> Unit, enabled: Boolean = true, stop: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        IrisMark()
        Text("IRIS", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.weight(1f))
        if (stop != null) Button(onClick = stop, colors = ButtonDefaults.buttonColors(containerColor = Clay.Tomato),
            shape = RoundedCornerShape(16.dp), modifier = Modifier.heightIn(min = 48.dp)) { Text("STOP") }
        IconButton(onClick = onSettings, enabled = enabled,
            modifier = Modifier.size(48.dp).clip(RoundedCornerShape(16.dp)).background(Clay.Surface.copy(alpha = .8f)).semantics { contentDescription = "Settings" }) {
            IrisSymbol(Symbol.Settings)
        }
    }
}

@Composable internal fun SettingToggle(title: String, checked: Boolean, enabled: Boolean = true, description: String? = null, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().toggleable(checked, enabled = enabled, role = Role.Switch, onValueChange = change).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Clay.Soft) }
        }
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

@Composable internal fun AccountSummary(email: String) {
    Row(Modifier.fillMaxWidth().clay(radius = 20).padding(16.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(42.dp).clip(RoundedCornerShape(14.dp)).background(Clay.Teal.copy(alpha = .09f)), contentAlignment = Alignment.Center) {
            IrisSymbol(Symbol.User, tint = Clay.Teal)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("Google account", style = MaterialTheme.typography.bodySmall, color = Clay.Soft)
            Text(email, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        IrisSymbol(Symbol.Check, Modifier.size(20.dp), Clay.Teal)
    }
}

@Composable internal fun Notice(message: String, dismiss: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Clay.Tomato.copy(alpha = .09f)).padding(start = 16.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(message, Modifier.weight(1f).padding(vertical = 8.dp), style = MaterialTheme.typography.bodyMedium)
        IconButton(onClick = dismiss, modifier = Modifier.semantics { contentDescription = "Dismiss notice" }) { IrisSymbol(Symbol.Close, tint = Clay.Soft) }
    }
}

@Composable internal fun StatusPill(label: String, live: Boolean) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(if (live) Clay.Teal.copy(alpha = .09f) else Clay.Surface)
        .padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        Box(Modifier.size(6.dp).clip(RoundedCornerShape(50)).background(if (live) Clay.Teal else Clay.Soft.copy(alpha = .5f)))
        Text(label, style = MaterialTheme.typography.labelMedium, color = if (live) Clay.Teal else Clay.Soft)
    }
}
