import 'package:flutter/material.dart';

import 'design_tokens.dart';

/// The KAYAN ERP theme.
///
/// Two jobs, in this order:
///  1. Express the identity (navy structure, one blue action colour, white
///     surfaces, hairline borders) through [AppColors].
///  2. Make every stock Material control look like it belongs to the same
///     product, so screens written years apart stop drifting: one control
///     height, one corner radius family, one table density, one focus ring.
///
/// Screens that only use standard Material widgets inherit the redesign
/// without being touched, which is what keeps this change a presentation
/// change rather than a rewrite.
abstract final class AppTheme {
  /// [textScale] is the user's size from settings. It changes *geometry* only
  /// - control heights and table rows - so a larger text cannot be clipped by
  /// a box that was measured for the default size. The text itself is scaled
  /// once, by `applyTextScale` at the root; scaling the font sizes here too
  /// would multiply the setting by itself on every rebuild.
  static ThemeData light({double textScale = 1}) =>
      _build(Brightness.light, textScale);
  static ThemeData dark({double textScale = 1}) =>
      _build(Brightness.dark, textScale);

  /// One step of extra room per unit of extra text size.
  static double _room(double base, double textScale, double perUnit) =>
      base + (textScale - 1) * perUnit;

  static ThemeData _build(Brightness brightness, double textScale) {
    final isLight = brightness == Brightness.light;
    final scheme = isLight ? _lightScheme : _darkScheme;
    final textTheme = _textTheme(scheme);
    final border = isLight ? AppColors.border : AppColors.darkBorder;
    final surface = isLight ? AppColors.surface : AppColors.darkSurface;
    final surfaceAlt = isLight ? AppColors.surfaceMuted : AppColors.darkSurfaceAlt;
    final canvas = isLight ? AppColors.background : AppColors.darkBackground;

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      textTheme: textTheme,
      scaffoldBackgroundColor: canvas,
      canvasColor: canvas,
      dividerColor: border,
      splashFactory: InkRipple.splashFactory,
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      hoverColor: scheme.primary.withValues(alpha: 0.06),
      focusColor: scheme.primary.withValues(alpha: 0.10),
      highlightColor: scheme.primary.withValues(alpha: 0.05),

      appBarTheme: AppBarTheme(
        centerTitle: false,
        toolbarHeight: _room(AppSizes.topBarHeight, textScale, 18),
        backgroundColor: surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        shape: Border(bottom: BorderSide(color: border)),
        iconTheme: IconThemeData(color: scheme.onSurfaceVariant, size: 20),
        titleTextStyle: textTheme.titleMedium?.copyWith(
          color: scheme.onSurface,
          fontWeight: FontWeight.w700,
        ),
      ),

      // Kept for the screens that still use a Rail; the shell itself draws
      // its own navy sidebar.
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: surface,
        indicatorColor: scheme.primaryContainer,
        indicatorShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        selectedIconTheme: IconThemeData(color: scheme.primary),
        unselectedIconTheme: IconThemeData(color: scheme.onSurfaceVariant),
        selectedLabelTextStyle: TextStyle(
          color: scheme.primary,
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
        unselectedLabelTextStyle: TextStyle(
          color: scheme.onSurfaceVariant,
          fontWeight: FontWeight.w500,
          fontSize: 12,
        ),
      ),

      navigationBarTheme: NavigationBarThemeData(
        height: 64,
        backgroundColor: surface,
        indicatorColor: scheme.primaryContainer,
        elevation: 0,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),

      drawerTheme: DrawerThemeData(
        backgroundColor: AppColors.navy,
        surfaceTintColor: Colors.transparent,
        width: 290,
        shape: const RoundedRectangleBorder(),
      ),

      listTileTheme: ListTileThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        minLeadingWidth: 22,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12),
        dense: true,
        iconColor: scheme.onSurfaceVariant,
        textColor: scheme.onSurface,
      ),

      tabBarTheme: TabBarThemeData(
        labelColor: scheme.primary,
        unselectedLabelColor: scheme.onSurfaceVariant,
        indicatorSize: TabBarIndicatorSize.label,
        dividerColor: border,
        indicatorColor: scheme.primary,
        labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
        unselectedLabelStyle: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w500,
        ),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: surfaceAlt,
        selectedColor: scheme.primaryContainer,
        side: BorderSide(color: border),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.sm),
        ),
        labelStyle: TextStyle(
          color: scheme.onSurface,
          fontWeight: FontWeight.w600,
          fontSize: 12,
        ),
        secondaryLabelStyle: TextStyle(color: scheme.onPrimaryContainer),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shadowColor: const Color(0x33142B4A),
        insetPadding: const EdgeInsets.all(AppSpacing.xxl),
        shape: RoundedRectangleBorder(
          borderRadius: AppRadii.dialog,
          side: BorderSide(color: border),
        ),
        titleTextStyle: textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w700,
          color: scheme.onSurface,
        ),
        contentTextStyle: textTheme.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
      ),

      popupMenuTheme: PopupMenuThemeData(
        color: surface,
        surfaceTintColor: Colors.transparent,
        elevation: 8,
        shadowColor: const Color(0x1F142B4A),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.lg),
          side: BorderSide(color: border),
        ),
        textStyle: textTheme.bodyMedium,
        labelTextStyle: WidgetStatePropertyAll(textTheme.bodyMedium),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isLight ? AppColors.surface : AppColors.darkSurfaceAlt,
        isDense: true,
        hintStyle: textTheme.bodyMedium?.copyWith(
          color: isLight ? AppColors.textDisabled : AppColors.darkTextMuted,
        ),
        labelStyle: textTheme.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
        floatingLabelStyle: textTheme.bodySmall?.copyWith(
          color: scheme.primary,
          fontWeight: FontWeight.w600,
        ),
        helperStyle: textTheme.bodySmall?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
        errorStyle: textTheme.bodySmall?.copyWith(color: scheme.error),
        prefixIconColor: scheme.onSurfaceVariant,
        suffixIconColor: scheme.onSurfaceVariant,
        prefixIconConstraints: const BoxConstraints(minWidth: 38, minHeight: 38),
        suffixIconConstraints: const BoxConstraints(minWidth: 38, minHeight: 38),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: AppRadii.control,
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadii.control,
          borderSide: BorderSide(color: border),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: AppRadii.control,
          borderSide: BorderSide(color: border.withValues(alpha: 0.6)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadii.control,
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadii.control,
          borderSide: BorderSide(color: scheme.error, width: 1.2),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: AppRadii.control,
          borderSide: BorderSide(color: scheme.error, width: 1.6),
        ),
      ),

      cardTheme: CardThemeData(
        color: surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: const EdgeInsets.symmetric(vertical: 6),
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadii.card,
          side: BorderSide(color: border),
        ),
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: ButtonStyle(
          minimumSize: WidgetStatePropertyAll(
            Size(0, _room(AppSizes.buttonHeight, textScale, 16)),
          ),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          ),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: AppRadii.control),
          ),
          textStyle: const WidgetStatePropertyAll(
            TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.disabled)) {
              return scheme.primary.withValues(alpha: 0.38);
            }
            if (states.contains(WidgetState.hovered) ||
                states.contains(WidgetState.pressed)) {
              return AppColors.primaryHover;
            }
            return scheme.primary;
          }),
          foregroundColor: WidgetStatePropertyAll(scheme.onPrimary),
          elevation: const WidgetStatePropertyAll(0),
          overlayColor: WidgetStatePropertyAll(
            Colors.white.withValues(alpha: 0.12),
          ),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: ButtonStyle(
          minimumSize: WidgetStatePropertyAll(
            Size(0, _room(AppSizes.buttonHeight, textScale, 16)),
          ),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          ),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: AppRadii.control),
          ),
          textStyle: const WidgetStatePropertyAll(
            TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          foregroundColor: WidgetStatePropertyAll(scheme.primary),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.hovered)) {
              return scheme.primary.withValues(alpha: 0.05);
            }
            return Colors.transparent;
          }),
          side: WidgetStatePropertyAll(BorderSide(color: border)),
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          minimumSize: WidgetStatePropertyAll(
            Size(0, _room(34, textScale, 12)),
          ),
          padding: const WidgetStatePropertyAll(
            EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          ),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: AppRadii.control),
          ),
          textStyle: const WidgetStatePropertyAll(
            TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
          ),
          foregroundColor: WidgetStatePropertyAll(scheme.primary),
        ),
      ),

      iconButtonTheme: IconButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(Size(34, 34)),
          maximumSize: const WidgetStatePropertyAll(Size(44, 44)),
          padding: const WidgetStatePropertyAll(EdgeInsets.all(6)),
          iconSize: const WidgetStatePropertyAll(19),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: AppRadii.control),
          ),
          foregroundColor: WidgetStatePropertyAll(scheme.onSurfaceVariant),
          overlayColor: WidgetStatePropertyAll(
            scheme.primary.withValues(alpha: 0.08),
          ),
        ),
      ),

      dataTableTheme: DataTableThemeData(
        headingRowColor: WidgetStatePropertyAll(surfaceAlt),
        headingRowHeight: _room(AppSizes.tableHeaderHeight, textScale, 16),
        dataRowMinHeight: _room(AppSizes.tableRowHeight, textScale, 16),
        dataRowMaxHeight: _room(AppSizes.tableRowHeight + 6, textScale, 24),
        headingTextStyle: textTheme.labelSmall?.copyWith(
          color: scheme.onSurfaceVariant,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
        ),
        dataTextStyle: textTheme.bodyMedium?.copyWith(color: scheme.onSurface),
        dividerThickness: 1,
        horizontalMargin: AppSpacing.lg,
        columnSpacing: AppSpacing.xl,
      ),

      dividerTheme: DividerThemeData(
        color: border,
        thickness: 1,
        space: 1,
      ),

      tooltipTheme: TooltipThemeData(
        waitDuration: const Duration(milliseconds: 400),
        decoration: BoxDecoration(
          color: AppColors.navy,
          borderRadius: BorderRadius.circular(AppRadii.sm),
        ),
        textStyle: const TextStyle(
          color: Colors.white,
          fontSize: 11.5,
          fontWeight: FontWeight.w500,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      ),

      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.navy,
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 13),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        insetPadding: const EdgeInsets.all(AppSpacing.lg),
      ),

      scrollbarTheme: ScrollbarThemeData(
        thickness: const WidgetStatePropertyAll(8),
        radius: const Radius.circular(8),
        crossAxisMargin: 2,
        thumbColor: WidgetStateProperty.resolveWith((states) {
          final base = isLight ? AppColors.borderStrong : AppColors.darkBorder;
          return states.contains(WidgetState.hovered)
              ? base.withValues(alpha: 0.9)
              : base.withValues(alpha: 0.6);
        }),
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
        linearTrackColor: surfaceAlt,
        circularTrackColor: surfaceAlt,
      ),

      checkboxTheme: CheckboxThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.xs),
        ),
        side: BorderSide(color: isLight ? AppColors.borderStrong : AppColors.darkBorder),
        visualDensity: VisualDensity.compact,
      ),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? Colors.white
              : (isLight ? AppColors.borderStrong : AppColors.darkTextMuted),
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? scheme.primary
              : (isLight ? AppColors.surfaceSunken : AppColors.darkSurfaceAlt),
        ),
      ),

      expansionTileTheme: ExpansionTileThemeData(
        iconColor: scheme.onSurfaceVariant,
        collapsedIconColor: scheme.onSurfaceVariant,
        textColor: scheme.onSurface,
        collapsedTextColor: scheme.onSurface,
        childrenPadding: const EdgeInsets.only(bottom: AppSpacing.sm),
        shape: const Border(),
        collapsedShape: const Border(),
      ),
    );
  }

  static const _lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppColors.primary,
    onPrimary: Colors.white,
    primaryContainer: AppColors.primarySoft,
    onPrimaryContainer: AppColors.navy,
    secondary: AppColors.accent,
    onSecondary: Colors.white,
    secondaryContainer: Color(0xFFE7EFFD),
    onSecondaryContainer: AppColors.navy,
    tertiary: AppColors.success,
    onTertiary: Colors.white,
    error: AppColors.error,
    onError: Colors.white,
    errorContainer: AppColors.errorSoft,
    onErrorContainer: Color(0xFF7A1D1D),
    surface: AppColors.surface,
    onSurface: AppColors.textPrimary,
    onSurfaceVariant: AppColors.textSecondary,
    surfaceContainerLowest: Colors.white,
    surfaceContainerLow: AppColors.surfaceMuted,
    surfaceContainer: AppColors.background,
    surfaceContainerHigh: AppColors.surfaceSunken,
    surfaceContainerHighest: AppColors.surfaceSunken,
    outline: AppColors.borderStrong,
    outlineVariant: AppColors.border,
    shadow: Color(0x1A142B4A),
    scrim: Color(0x66142B4A),
    inverseSurface: AppColors.navy,
    onInverseSurface: Colors.white,
    inversePrimary: Color(0xFF9DBDF0),
    surfaceTint: Colors.transparent,
  );

  static const _darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: Color(0xFF7FA9E8),
    onPrimary: Color(0xFF0B1B2E),
    primaryContainer: Color(0xFF1D3A60),
    onPrimaryContainer: Color(0xFFDCE8F8),
    secondary: Color(0xFF8FB6F7),
    onSecondary: Color(0xFF0B1B2E),
    secondaryContainer: Color(0xFF1B3252),
    onSecondaryContainer: Color(0xFFDCE8F8),
    tertiary: Color(0xFF6FC3A0),
    onTertiary: Color(0xFF06231A),
    error: Color(0xFFF08A8A),
    onError: Color(0xFF3B0A0A),
    errorContainer: Color(0xFF4A1D1D),
    onErrorContainer: Color(0xFFFFDADA),
    surface: AppColors.darkSurface,
    onSurface: AppColors.darkText,
    onSurfaceVariant: AppColors.darkTextMuted,
    surfaceContainerLowest: Color(0xFF0A1524),
    surfaceContainerLow: AppColors.darkSurfaceAlt,
    surfaceContainer: AppColors.darkSurface,
    surfaceContainerHigh: Color(0xFF1B2F49),
    surfaceContainerHighest: Color(0xFF21374F),
    outline: Color(0xFF3A5069),
    outlineVariant: AppColors.darkBorder,
    shadow: Colors.black,
    scrim: Color(0xAA000000),
    inverseSurface: Color(0xFFE7EEF7),
    onInverseSurface: AppColors.navy,
    inversePrimary: AppColors.primary,
    surfaceTint: Colors.transparent,
  );

  /// A compact, high-legibility type scale. Financial screens need many
  /// labels and few headings, so the steps between sizes are small and the
  /// weights carry the hierarchy instead.
  static TextTheme _textTheme(ColorScheme scheme) {
    final base = Typography.material2021(colorScheme: scheme);
    final t = scheme.brightness == Brightness.light ? base.black : base.white;
    return t.copyWith(
      displaySmall: t.displaySmall?.copyWith(
        fontSize: 30,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.6,
        height: 1.2,
      ),
      headlineMedium: t.headlineMedium?.copyWith(
        fontSize: 24,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.4,
        height: 1.25,
      ),
      headlineSmall: t.headlineSmall?.copyWith(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
        height: 1.3,
      ),
      titleLarge: t.titleLarge?.copyWith(
        fontSize: 17,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.1,
      ),
      titleMedium: t.titleMedium?.copyWith(
        fontSize: 14.5,
        fontWeight: FontWeight.w600,
      ),
      titleSmall: t.titleSmall?.copyWith(
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
      bodyLarge: t.bodyLarge?.copyWith(fontSize: 14, height: 1.45),
      bodyMedium: t.bodyMedium?.copyWith(fontSize: 13.5, height: 1.45),
      bodySmall: t.bodySmall?.copyWith(fontSize: 12, height: 1.4),
      labelLarge: t.labelLarge?.copyWith(
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
      labelMedium: t.labelMedium?.copyWith(
        fontSize: 12,
        fontWeight: FontWeight.w600,
      ),
      labelSmall: t.labelSmall?.copyWith(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.4,
      ),
    );
  }
}
