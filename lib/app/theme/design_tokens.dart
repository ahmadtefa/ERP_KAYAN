import 'package:flutter/material.dart';

/// The single source of truth for the KAYAN ERP visual language.
///
/// Every screen, dialog and shared widget reads its colours, spacing, radii
/// and control sizes from here, so a change of identity happens once instead
/// of being copied into dozens of `EdgeInsets` and `Color(0x...)` literals.
///
/// The identity follows Microsoft's Fluent 2 language: a neutral grey
/// canvas, white surfaces with hairline borders and soft depth, one brand
/// blue for action, and a distinct accent per product section (see
/// [SectionAccents]) so the place you are in is recognisable by colour, not
/// only by title. Financial data stays the loudest thing on the screen.
abstract final class AppColors {
  // Structure — brand marks and text on inverted surfaces.
  static const navy = Color(0xFF142B4A);
  static const navyDeep = Color(0xFF0E1F36);
  static const navySoft = Color(0xFF1D3A60);

  // Action — Fluent brand blue, with its hover and pressed steps.
  static const primary = Color(0xFF0F6CBD);
  static const primaryHover = Color(0xFF0E5DAC);
  static const primaryPressed = Color(0xFF0E4E8A);
  static const primarySoft = Color(0xFFE8F1FA);
  static const accent = Color(0xFF2B7CD3);

  // Canvas and surfaces (Fluent neutral background ramp).
  static const background = Color(0xFFF5F5F5);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFFAFAFA);
  static const surfaceSunken = Color(0xFFF0F0F0);

  // Text (Fluent neutral foreground ramp).
  static const textPrimary = Color(0xFF242424);
  static const textSecondary = Color(0xFF616161);
  static const textDisabled = Color(0xFFA3A3A3);
  static const onNavy = Color(0xFFF7FAFF);
  static const onNavyMuted = Color(0xFFB7C6DA);

  // Lines.
  static const border = Color(0xFFE0E0E0);
  static const borderStrong = Color(0xFFC8C8C8);

  // Meaning.
  static const success = Color(0xFF16845B);
  static const successSoft = Color(0xFFE7F4EE);
  static const warning = Color(0xFFD99018);
  static const warningSoft = Color(0xFFFDF3E2);
  static const error = Color(0xFFD64545);
  static const errorSoft = Color(0xFFFBEAEA);
  static const infoSoft = Color(0xFFEAF1FC);

  // Dashboard chart series. Sales follow the brand primary and the result
  // line the success green; purchases keep a warm gold so the two bar
  // series stay tellable apart at a glance in either theme.
  static const chartPurchases = Color(0xFF8A6A2F);
  static const chartPurchasesDark = Color(0xFFD8B678);

  // Dark theme counterparts (Fluent neutral dark ramp).
  static const darkBackground = Color(0xFF141414);
  static const darkSurface = Color(0xFF1F1F1F);
  static const darkSurfaceAlt = Color(0xFF292929);
  static const darkBorder = Color(0xFF3D3D3D);
  static const darkText = Color(0xFFF5F5F5);
  static const darkTextMuted = Color(0xFFADADAD);
}

/// One section's identity colour: the strong step for icons and selected
/// text, the soft step for selected backgrounds, and a brighter step that
/// stays legible on dark surfaces.
class SectionAccent {
  const SectionAccent({
    required this.base,
    required this.soft,
    required this.darkBase,
  });

  final Color base;
  final Color soft;
  final Color darkBase;

  Color of(Brightness brightness) =>
      brightness == Brightness.dark ? darkBase : base;

  Color softOf(Brightness brightness) => brightness == Brightness.dark
      ? darkBase.withValues(alpha: 0.18)
      : soft;
}

/// The colour of each main section of the product. The navigation, the top
/// bar and the dashboard figures all read from here, so «المبيعات» is green
/// everywhere and «العملاء والموردون» keep their own rose identity instead
/// of borrowing the accounting colour.
abstract final class SectionAccents {
  static const overview = SectionAccent(
    base: Color(0xFF0F6CBD),
    soft: Color(0xFFE5F0FA),
    darkBase: Color(0xFF62ABF0),
  );
  static const accounting = SectionAccent(
    base: Color(0xFF744DA9),
    soft: Color(0xFFF0EAF8),
    darkBase: Color(0xFFB79CED),
  );

  /// Banks & cashboxes live inside the accounting group but are their own
  /// daily destination, so the cash entry carries this teal instead.
  static const cash = SectionAccent(
    base: Color(0xFF038387),
    soft: Color(0xFFE0F2F2),
    darkBase: Color(0xFF4FC4C4),
  );
  static const parties = SectionAccent(
    base: Color(0xFFB83A7A),
    soft: Color(0xFFF9E9F2),
    darkBase: Color(0xFFE87FB0),
  );
  static const inventory = SectionAccent(
    base: Color(0xFF986F0B),
    soft: Color(0xFFFAF0DA),
    darkBase: Color(0xFFE0B45C),
  );
  static const sales = SectionAccent(
    base: Color(0xFF107C10),
    soft: Color(0xFFE5F3E5),
    darkBase: Color(0xFF5FBF5F),
  );
  static const purchases = SectionAccent(
    base: Color(0xFFCA5010),
    soft: Color(0xFFFBEAE0),
    darkBase: Color(0xFFF09A6B),
  );
  static const insights = SectionAccent(
    base: Color(0xFF4B53BC),
    soft: Color(0xFFE8E9F8),
    darkBase: Color(0xFF8F96E8),
  );
  static const administration = SectionAccent(
    base: Color(0xFF64707D),
    soft: Color(0xFFEDF0F3),
    darkBase: Color(0xFFA7B3BF),
  );
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

  // Fluent controls sit on the smaller step; cards and dialogs keep the
  // roomier ones.
  static BorderRadius get control => BorderRadius.circular(sm);
  static BorderRadius get card => BorderRadius.circular(lg);
  static BorderRadius get dialog => BorderRadius.circular(lg);
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

/// Fluent depth: two soft layers (a tight contact shadow plus a wider
/// ambient one). Light enough to read as «lifted», never as decoration.
abstract final class AppShadows {
  static const none = <BoxShadow>[];

  static const raised = <BoxShadow>[
    BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x0F000000), blurRadius: 2, offset: Offset(0, 0)),
  ];

  static const overlay = <BoxShadow>[
    BoxShadow(color: Color(0x24000000), blurRadius: 32, offset: Offset(0, 8)),
    BoxShadow(color: Color(0x14000000), blurRadius: 4, offset: Offset(0, 0)),
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
