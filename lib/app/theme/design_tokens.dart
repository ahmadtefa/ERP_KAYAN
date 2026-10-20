import 'package:flutter/material.dart';

/// The single source of truth for the KAYAN ERP visual language.
///
/// Every screen, dialog and shared widget reads its colours, spacing, radii
/// and control sizes from here, so a change of identity happens once instead
/// of being copied into dozens of `EdgeInsets` and `Color(0x...)` literals.
///
/// The identity is deliberately restrained: navy for structure, one blue for
/// action, white surfaces, hairline borders and almost no shadow. Financial
/// data is the loudest thing on the screen, never the chrome around it.
abstract final class AppColors {
  // Structure — navigation, brand, headings on dark surfaces.
  static const navy = Color(0xFF142B4A);
  static const navyDeep = Color(0xFF0E1F36);
  static const navySoft = Color(0xFF1D3A60);

  // Action — buttons, links, selected states.
  static const primary = Color(0xFF2457A7);
  static const primaryHover = Color(0xFF1D4A90);
  static const primarySoft = Color(0xFFEAF1FC);
  static const accent = Color(0xFF367BF5);

  // Canvas and surfaces.
  static const background = Color(0xFFF4F7FB);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF8FAFD);
  static const surfaceSunken = Color(0xFFEEF3F9);

  // Text.
  static const textPrimary = Color(0xFF172B4D);
  static const textSecondary = Color(0xFF68778D);
  static const textDisabled = Color(0xFF9AA7B8);
  static const onNavy = Color(0xFFF7FAFF);
  static const onNavyMuted = Color(0xFFB7C6DA);

  // Lines.
  static const border = Color(0xFFE2E8F0);
  static const borderStrong = Color(0xFFCBD5E1);

  // Meaning.
  static const success = Color(0xFF16845B);
  static const successSoft = Color(0xFFE7F4EE);
  static const warning = Color(0xFFD99018);
  static const warningSoft = Color(0xFFFDF3E2);
  static const error = Color(0xFFD64545);
  static const errorSoft = Color(0xFFFBEAEA);
  static const infoSoft = Color(0xFFEAF1FC);

  // Dark theme counterparts.
  static const darkBackground = Color(0xFF0B1728);
  static const darkSurface = Color(0xFF122138);
  static const darkSurfaceAlt = Color(0xFF17293F);
  static const darkBorder = Color(0xFF24374F);
  static const darkText = Color(0xFFE7EEF7);
  static const darkTextMuted = Color(0xFF9FB0C6);
}

/// A 4-point spacing scale. Nothing in the UI should invent its own gaps.
abstract final class AppSpacing {
  static const xxs = 2.0;
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 24.0;
  static const xxxl = 32.0;

  static const pagePadding = EdgeInsets.symmetric(horizontal: 24, vertical: 20);
  static const compactPagePadding =
      EdgeInsets.symmetric(horizontal: 16, vertical: 16);
}

/// Corner radii, from chips to dialogs.
abstract final class AppRadii {
  static const xs = 4.0;
  static const sm = 6.0;
  static const md = 8.0;
  static const lg = 10.0;
  static const xl = 14.0;
  static const pill = 999.0;

  static BorderRadius get control => BorderRadius.circular(md);
  static BorderRadius get card => BorderRadius.circular(lg);
  static BorderRadius get dialog => BorderRadius.circular(xl);
  static BorderRadius get chip => BorderRadius.circular(sm);
}

/// Fixed heights and layout limits that keep desktop screens aligned.
abstract final class AppSizes {
  static const controlHeight = 40.0;
  static const buttonHeight = 38.0;
  static const compactControlHeight = 34.0;
  static const topBarHeight = 62.0;
  static const sidebarWidth = 250.0;
  static const sidebarRailWidth = 78.0;
  static const maxContentWidth = 1560.0;
  static const tableRowHeight = 42.0;
  static const tableHeaderHeight = 40.0;
}

/// Shadows are almost invisible on purpose: a hairline border already
/// separates a panel from the canvas.
abstract final class AppShadows {
  static const none = <BoxShadow>[];

  static const raised = <BoxShadow>[
    BoxShadow(color: Color(0x0A142B4A), blurRadius: 10, offset: Offset(0, 2)),
  ];

  static const overlay = <BoxShadow>[
    BoxShadow(color: Color(0x1A142B4A), blurRadius: 28, offset: Offset(0, 12)),
  ];
}

/// Semantic tones used by status pills, KPI accents and inline notices.
enum AppTone { neutral, info, success, warning, danger }

extension AppToneColors on AppTone {
  Color get foreground => switch (this) {
    AppTone.neutral => AppColors.textSecondary,
    AppTone.info => AppColors.primary,
    AppTone.success => AppColors.success,
    AppTone.warning => const Color(0xFF9A6508),
    AppTone.danger => AppColors.error,
  };

  Color get background => switch (this) {
    AppTone.neutral => AppColors.surfaceSunken,
    AppTone.info => AppColors.infoSoft,
    AppTone.success => AppColors.successSoft,
    AppTone.warning => AppColors.warningSoft,
    AppTone.danger => AppColors.errorSoft,
  };
}
