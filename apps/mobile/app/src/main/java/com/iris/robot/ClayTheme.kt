package com.iris.robot

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Shared with apps/web/src/index.css: the IRIS clay palette.
object Clay {
    val Mist = Color(0xFFDCEBE4)
    val MistDeep = Color(0xFFC9DED5)
    val Surface = Color(0xFFEDF6F1)
    val Pine = Color(0xFF123832)
    val Soft = Color(0xFF4A6862)
    val Teal = Color(0xFF22786A)
    val Honey = Color(0xFFF4B23E)
    val Sky = Color(0xFF8EC5DD)
    val Tomato = Color(0xFFE4553F)
}

@Composable fun IrisTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Clay.Teal, onPrimary = Color.White,
            secondary = Clay.Honey, onSecondary = Clay.Pine,
            tertiary = Clay.Sky, onTertiary = Clay.Pine,
            background = Clay.Mist, onBackground = Clay.Pine,
            surface = Clay.Surface, onSurface = Clay.Pine,
            surfaceVariant = Clay.MistDeep, onSurfaceVariant = Clay.Soft,
            error = Clay.Tomato, onError = Color.White, outline = Clay.Soft,
        ),
        shapes = Shapes(small = RoundedCornerShape(16.dp), medium = RoundedCornerShape(24.dp), large = RoundedCornerShape(32.dp)),
        typography = Typography(
            headlineLarge = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.ExtraBold, fontSize = 32.sp, color = Clay.Pine),
            titleLarge = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Clay.Pine),
        ),
        content = content,
    )
}

/** Soft cast shadow, lit upper edge, and shaded lower edge form a raised clay slab. */
fun Modifier.clay(tone: Color = Clay.Surface, radius: Int = 28): Modifier {
    val shape = RoundedCornerShape(radius.dp)
    return shadow(12.dp, shape, ambientColor = Clay.Pine.copy(alpha = .16f), spotColor = Clay.Pine.copy(alpha = .22f))
        .background(Brush.linearGradient(listOf(lerp(tone, Color.White, .35f), tone, tone, lerp(tone, Clay.Pine, .08f))), shape)
        .border(1.dp, Brush.linearGradient(listOf(Color.White.copy(alpha = .95f), tone, Clay.Pine.copy(alpha = .08f))), shape)
}

@Composable fun ClayCard(modifier: Modifier = Modifier, tone: Color = Clay.Surface, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.clay(tone).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content)
}

@Composable fun ClayButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tone: Color = Clay.Teal,
    content: @Composable RowScope.() -> Unit,
) {
    Button(onClick = onClick, enabled = enabled,
        modifier = modifier.clay(if (enabled) tone else Clay.MistDeep, 24),
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, disabledContainerColor = Color.Transparent,
            contentColor = if (tone == Clay.Teal || tone == Clay.Tomato) Color.White else Clay.Pine),
        shape = RoundedCornerShape(24.dp), contentPadding = PaddingValues(horizontal = 22.dp, vertical = 16.dp), content = content)
}
