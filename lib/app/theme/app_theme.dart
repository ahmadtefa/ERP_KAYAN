import 'package:flutter/material.dart';

/// Central Material 3 theme configuration.
///
/// The palette is intentionally neutral so that company branding can be
/// applied later without touching individual screens.
/// REQUIRES BUSINESS DECISION: final brand colours and typography.
abstract final class AppTheme {
  static const _seed = Color(0xFF0B6E4F);

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: _seed,
      brightness: brightness,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      visualDensity: VisualDensity.standard,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        backgroundColor: scheme.surfaceContainer,
        foregroundColor: scheme.onSurface,
        elevation: 0,
      ),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        isDense: true,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      dataTableTheme: const DataTableThemeData(
        columnSpacing: 24,
        horizontalMargin: 12,
      ),
    );
  }
}
