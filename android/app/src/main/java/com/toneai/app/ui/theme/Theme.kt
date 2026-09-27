package com.toneai.app.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val Violet = Color(0xFF6C4DF6)
private val VioletDark = Color(0xFF3F2E86)
private val Pink = Color(0xFFFF7AB6)
private val SurfaceLight = Color(0xFFFDF7FF)
private val SurfaceDark = Color(0xFF141218)

private val LightColors = lightColorScheme(
    primary = Violet,
    secondary = Pink,
    background = SurfaceLight,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFCBBEFF),
    secondary = Pink,
    background = SurfaceDark,
)

/**
 * Material 3 theme with dark/light support and dynamic color on Android 12+.
 */
@Composable
fun ToneTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}

object ToneColors {
    val VioletDark: Color = Color(0xFF3F2E86)
}
