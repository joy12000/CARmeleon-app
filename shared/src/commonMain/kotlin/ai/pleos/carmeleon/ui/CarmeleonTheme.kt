package ai.pleos.carmeleon.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Shared vehicle-app tokens, derived from the user-approved Concept 02. */
data class VehicleColors(
    val surface: Color,
    val panel: Color,
    val ink: Color,
    val secondary: Color,
    val divider: Color,
    val muted: Color,
    val blue: Color,
    val map: Color,
    val blocks: Color,
    val streets: Color,
    val river: Color,
    val roadOutline: Color,
    val road: Color,
    val mapLabel: Color,
    val dock: Color = Color(0xFF101114),
    val dockText: Color = Color(0xFFBFC2C9),
    val dockSelected: Color = Color(0xFF303239),
)

private val LightVehicleColors = VehicleColors(
    surface = Color.White,
    panel = Color(0xFFF5F5F5),
    ink = Color(0xFF191C20),
    secondary = Color(0xFF646970),
    divider = Color(0xFFE4E5E7),
    muted = Color(0xFFF0F1F3),
    blue = Color(0xFF316EE8),
    map = Color(0xFFE8E7E3),
    blocks = Color(0xFFE1E0DC),
    streets = Color(0xFFF4F3EF),
    river = Color(0xFFC4DAE1),
    roadOutline = Color(0xFFD4D3CF),
    road = Color(0xFFFEFDFB),
    mapLabel = Color(0xFF676C6A),
)

private val DarkVehicleColors = VehicleColors(
    surface = Color(0xFF202124),
    panel = Color(0xFF27282C),
    ink = Color(0xFFF2F3F5),
    secondary = Color(0xFFB0B3BB),
    divider = Color(0xFF3C3F45),
    muted = Color(0xFF35373D),
    blue = Color(0xFF528EF4),
    map = Color(0xFF303338),
    blocks = Color(0xFF35393E),
    streets = Color(0xFF41464C),
    river = Color(0xFF293E4A),
    roadOutline = Color(0xFF262B30),
    road = Color(0xFF50555C),
    mapLabel = Color(0xFFAFB3B8),
)

val LocalVehicleColors = staticCompositionLocalOf { LightVehicleColors }

private val VehicleTypography = Typography(
    headlineLarge = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Normal, fontSize = 34.sp, lineHeight = 42.sp),
    headlineMedium = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 26.sp, lineHeight = 37.sp),
    headlineSmall = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 23.sp, lineHeight = 33.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 20.sp, lineHeight = 29.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 16.sp, lineHeight = 24.sp),
    titleSmall = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 21.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 25.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 19.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 18.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Normal, fontSize = 11.sp, lineHeight = 16.sp),
)

@Composable
fun CarmeleonTheme(dark: Boolean, content: @Composable () -> Unit) {
    val colors = if (dark) DarkVehicleColors else LightVehicleColors
    val material = if (dark) darkColorScheme(
        primary = Color(0xFF285FD4), onPrimary = Color.White,
        surface = colors.surface, onSurface = colors.ink,
        surfaceVariant = colors.panel, onSurfaceVariant = colors.secondary,
        background = colors.surface, onBackground = colors.ink,
        outline = colors.divider, secondaryContainer = colors.muted,
        onSecondaryContainer = colors.ink,
    ) else lightColorScheme(
        primary = Color(0xFF285FD4), onPrimary = Color.White,
        surface = colors.surface, onSurface = colors.ink,
        surfaceVariant = colors.panel, onSurfaceVariant = colors.secondary,
        background = colors.surface, onBackground = colors.ink,
        outline = colors.divider, secondaryContainer = colors.muted,
        onSecondaryContainer = colors.ink,
    )
    CompositionLocalProvider(LocalVehicleColors provides colors) {
        MaterialTheme(colorScheme = material, typography = VehicleTypography, content = content)
    }
}
