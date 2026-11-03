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
import androidx.compose.ui.text.TextStyle
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
    val Field = Color(0xFFE5EFE9)
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
        shapes = Shapes(small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(20.dp), large = RoundedCornerShape(28.dp)),
        typography = Typography(
            headlineLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 36.sp, letterSpacing = (-.7).sp),
            headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 26.sp, lineHeight = 33.sp, letterSpacing = (-.5).sp),
            titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp),
            titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
            bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 24.sp),
            bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 21.sp),
            bodySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 12.sp, lineHeight = 18.sp),
            labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 20.sp),
            labelMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
        ),
        content = content,
    )
}

/** Soft cast shadow, lit upper edge, and shaded lower edge form a raised clay slab. */
fun Modifier.clay(tone: Color = Clay.Surface, radius: Int = 24): Modifier {
    val shape = RoundedCornerShape(radius.dp)
    return shadow(7.dp, shape, ambientColor = Clay.Pine.copy(alpha = .07f), spotColor = Clay.Pine.copy(alpha = .12f))
        .background(Brush.linearGradient(listOf(lerp(tone, Color.White, .18f), tone, lerp(tone, Clay.Pine, .035f))), shape)
        .border(1.dp, Brush.linearGradient(listOf(Color.White.copy(alpha = .8f), tone, Clay.Pine.copy(alpha = .05f))), shape)
}

@Composable fun ClayButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tone: Color = Clay.Teal,
    content: @Composable RowScope.() -> Unit,
) {
    Button(onClick = onClick, enabled = enabled,
        modifier = modifier.defaultMinSize(minHeight = 56.dp).clay(if (enabled) tone else Clay.MistDeep, 20),
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent, disabledContainerColor = Color.Transparent,
            contentColor = if (tone == Clay.Teal || tone == Clay.Tomato) Color.White else Clay.Pine),
        shape = RoundedCornerShape(20.dp), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 15.dp), content = content)
}
