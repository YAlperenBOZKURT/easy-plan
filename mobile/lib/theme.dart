import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';

/// Tasarım tokenları — web arayüzüyle birebir aynı değerler.
/// Kaynak: design/spec.css (:root ve @media prefers-color-scheme: dark).
@immutable
class PlannerTokens extends ThemeExtension<PlannerTokens> {
  const PlannerTokens({
    required this.bg,
    required this.surface,
    required this.surface2,
    required this.surfaceHover,
    required this.border,
    required this.borderStrong,
    required this.text,
    required this.textMuted,
    required this.textFaint,
    required this.accent,
    required this.accentFg,
    required this.danger,
    required this.cardColors,
  });

  final Color bg;
  final Color surface;
  final Color surface2;
  final Color surfaceHover;
  final Color border;
  final Color borderStrong;
  final Color text;
  final Color textMuted;
  final Color textFaint;
  final Color accent;
  final Color accentFg;
  final Color danger;

  /// Kart renkleri: sunucudaki anahtarlarla ('red', 'blue', …) eşleşir.
  final Map<String, Color> cardColors;

  Color cardColor(String key) => cardColors[key] ?? cardColors['blue']!;

  static const light = PlannerTokens(
    bg: Color(0xFFF5F7F9),
    surface: Color(0xFFFFFFFF),
    surface2: Color(0xFFEEF1F5),
    surfaceHover: Color(0xFFE7EBF1),
    border: Color(0xFFE2E7EE),
    borderStrong: Color(0xFFC8D1DB),
    text: Color(0xFF161D26),
    textMuted: Color(0xFF5B6673),
    textFaint: Color(0xFF8F9AA6),
    accent: Color(0xFF2F6FED),
    accentFg: Color(0xFFFFFFFF),
    danger: Color(0xFFD33C58),
    cardColors: {
      'red': Color(0xFFD9566A),
      'orange': Color(0xFFCF7C38),
      'amber': Color(0xFFB08A12),
      'green': Color(0xFF3D9C68),
      'teal': Color(0xFF2F9A95),
      'blue': Color(0xFF3A78E0),
      'violet': Color(0xFF7A5EDE),
      'pink': Color(0xFFCF5595),
    },
  );

  static const dark = PlannerTokens(
    bg: Color(0xFF0D1117),
    surface: Color(0xFF141A21),
    surface2: Color(0xFF1A212A),
    surfaceHover: Color(0xFF212A35),
    border: Color(0xFF242D38),
    borderStrong: Color(0xFF374350),
    text: Color(0xFFE5EBF2),
    textMuted: Color(0xFF98A4B2),
    textFaint: Color(0xFF69757F),
    accent: Color(0xFF79B0FF),
    accentFg: Color(0xFF0B1220),
    danger: Color(0xFFFF7B8E),
    cardColors: {
      'red': Color(0xFFFF9AA5),
      'orange': Color(0xFFFFB489),
      'amber': Color(0xFFECC96F),
      'green': Color(0xFF88D8A6),
      'teal': Color(0xFF77D2CE),
      'blue': Color(0xFF96C0FF),
      'violet': Color(0xFFBBA7FF),
      'pink': Color(0xFFFF9FC8),
    },
  );

  @override
  PlannerTokens copyWith({Map<String, Color>? cardColors}) => PlannerTokens(
    bg: bg,
    surface: surface,
    surface2: surface2,
    surfaceHover: surfaceHover,
    border: border,
    borderStrong: borderStrong,
    text: text,
    textMuted: textMuted,
    textFaint: textFaint,
    accent: accent,
    accentFg: accentFg,
    danger: danger,
    cardColors: cardColors ?? this.cardColors,
  );

  @override
  PlannerTokens lerp(ThemeExtension<PlannerTokens>? other, double t) =>
      t < .5 ? this : (other as PlannerTokens? ?? this);
}

/// Köşe yarıçapları (--r-sm … --r-xl)
class R {
  static const sm = 6.0;
  static const md = 10.0;
  static const lg = 14.0;
  static const xl = 20.0;
}

extension TokensOf on BuildContext {
  PlannerTokens get tokens => Theme.of(this).extension<PlannerTokens>()!;
}

ThemeData buildTheme(Brightness brightness) {
  final t = brightness == Brightness.dark
      ? PlannerTokens.dark
      : PlannerTokens.light;

  return ThemeData(
    brightness: brightness,
    useMaterial3: true,
    scaffoldBackgroundColor: t.bg,
    colorScheme:
        ColorScheme.fromSeed(
          seedColor: t.accent,
          brightness: brightness,
        ).copyWith(
          surface: t.surface,
          primary: t.accent,
          onPrimary: t.accentFg,
          error: t.danger,
        ),
    extensions: [t],
    fontFamily: null,
    textTheme: Typography.material2021(platform: defaultTargetPlatform).black
        .apply(bodyColor: t.text, displayColor: t.text)
        .copyWith(
          titleMedium: TextStyle(
            fontSize: 14.5,
            fontWeight: FontWeight.w600,
            color: t.text,
            letterSpacing: -.15,
          ),
          bodyMedium: TextStyle(fontSize: 13.5, color: t.text, height: 1.35),
          bodySmall: TextStyle(fontSize: 12, color: t.textMuted, height: 1.35),
          labelSmall: TextStyle(
            fontSize: 11.5,
            fontWeight: FontWeight.w600,
            letterSpacing: .3,
            color: t.textFaint,
          ),
        ),
    dividerColor: t.border,
    appBarTheme: AppBarTheme(
      backgroundColor: t.surface,
      foregroundColor: t.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      shape: Border(bottom: BorderSide(color: t.border)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: t.surface2,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(R.md),
        borderSide: BorderSide(color: t.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(R.md),
        borderSide: BorderSide(color: t.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(R.md),
        borderSide: BorderSide(color: t.accent, width: 1.5),
      ),
      labelStyle: TextStyle(color: t.textFaint, fontSize: 13),
      hintStyle: TextStyle(color: t.textFaint, fontSize: 13.5),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: t.accent,
        foregroundColor: t.accentFg,
        minimumSize: const Size(0, 46),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(R.sm),
        ),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: t.text,
        minimumSize: const Size(0, 44),
        side: BorderSide(color: t.borderStrong),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(R.sm),
        ),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: t.textMuted,
        minimumSize: const Size(0, 44),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: t.surface2,
      contentTextStyle: TextStyle(color: t.text, fontSize: 13),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.md)),
    ),
  );
}
