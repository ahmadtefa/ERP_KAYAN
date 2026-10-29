import 'package:flutter/material.dart';

/// The single source of truth for the KAYAN ERP visual language.
///
/// Every screen, dialog and shared widget reads its colours, spacing, radii
/// and control sizes from here, so a change of identity happens once instead
/// of being copied into dozens of `EdgeInsets` and `Color(0x...)` literals.
///
/// The identity is formal and deep: a navy structure (navigation, brand
/// surfaces, headings) with a royal blue for action and selection, pale
/// blue tints behind content, and a distinct accent per product section
/// (see [SectionAccents]) tuned to sit harmoniously on both the navy
/// sidebar and the white work surfaces — so the place you are in is
/// recognisable by colour, not only by title. Financial data stays the
/// loudest thing on the screen.
abstract final class AppColors {
  // Structure — the navy the program is framed in.
  static const navy = Color(0xFF0A1E3C);
  static const navyDeep = Color(0xFF06142A);
  static const navySoft = Color(0xFF16305C);

  // The sidebar and drawer, in both themes: a navy column whose text and
  // hairlines are stepped from the same ramp.
  static const sidebarBackground = navy;
  static const sidebarBackgroundDeep = navyDeep;
  static const onSidebar = Color(0xFFEAF1FC);
  static const onSidebarMuted = Color(0xFF93A9CC);
  static const sidebarHairline = Color(0x1FFFFFFF);

  // Action — royal blue, with its hover and pressed steps deepening
  // towards the navy so a press reads as commitment, not as a flicker.
  static const primary = Color(0xFF1D5CD6);
  static const primaryHover = Color(0xFF1A4FB8);
  static const primaryPressed = Color(0xFF173F8F);
  static const primarySoft = Color(0xFFE9F0FD);
  static const accent = Color(0xFF3B82E0);

  // Canvas and surfaces — cool, faintly blue light behind white cards.
  static const background = Color(0xFFF3F6FB);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF8FAFD);
  static const surfaceSunken = Color(0xFFEAF0F8);

  // Text — navy-tinted ink rather than neutral black.
  static const textPrimary = Color(0xFF16233A);
  static const textSecondary = Color(0xFF5A6B84);
  static const textDisabled = Color(0xFF9AA9BE);
  static const onNavy = Color(0xFFF7FAFF);
  static const onNavyMuted = Color(0xFFB7C6DA);

  // Lines.
  static const border = Color(0xFFDCE5F2);
  static const borderStrong = Color(0xFFB9C8DE);

  // Meaning.
  static const success = Color(0xFF12805C);
  static const successSoft = Color(0xFFE6F4EE);
  static const warning = Color(0xFFC77700);
  static const warningSoft = Color(0xFFFBF1DE);
  static const error = Color(0xFFD92D20);
  static const errorSoft = Color(0xFFFBEAEA);
  static const infoSoft = Color(0xFFE9F0FD);

  // Dashboard chart series. Sales follow the brand primary and the result
  // line the success green; purchases keep a warm gold so the two bar
  // series stay tellable apart at a glance in either theme.
  static const chartPurchases = Color(0xFF8A6A2F);
  static const chartPurchasesDark = Color(0xFFD8B678);

  // Dark theme counterparts — the same navy deepened, never neutral grey.
  static const darkBackground = Color(0xFF0A1322);
  static const darkSurface = Color(0xFF111E33);
  static const darkSurfaceAlt = Color(0xFF182841);
  static const darkBorder = Color(0xFF2A3F61);
  static const darkText = Color(0xFFEAF1FC);
  static const darkTextMuted = Color(0xFF9DB2D0);
}

/// The one gradient in the product: the navy frame (sidebar, drawer and
/// brand panels) deepens from its lit edge to its far edge. Content
/// surfaces stay flat — depth there comes from borders and shadows, so
/// figures never sit on a slope.
abstract final class AppGradients {
  static const sidebar = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [AppColors.navySoft, AppColors.navy, AppColors.navyDeep],
    stops: [0, 0.45, 1],
  );

  static const brand = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [AppColors.navySoft, AppColors.navyDeep],
  );
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
    base: Color(0xFF1D5CD6),
    soft: Color(0xFFE9F0FD),
    darkBase: Color(0xFF7FA9F5),
  );
  static const accounting = SectionAccent(
    base: Color(0xFF6D4FB0),
    soft: Color(0xFFF0EBFA),
    darkBase: Color(0xFFBFA7EC),
  );

  /// Banks & cashboxes live inside the accounting group but are their own
  /// daily destination, so the cash entry carries this teal instead.
  static const cash = SectionAccent(
    base: Color(0xFF047A8C),
    soft: Color(0xFFE2F2F5),
    darkBase: Color(0xFF5FC7D4),
  );
  static const parties = SectionAccent(
    base: Color(0xFFB03070),
    soft: Color(0xFFFAE9F2),
    darkBase: Color(0xFFEE8FBB),
  );
  static const inventory = SectionAccent(
    base: Color(0xFF9A6B0F),
    soft: Color(0xFFFAF1DC),
    darkBase: Color(0xFFE3B95E),
  );
  static const sales = SectionAccent(
    base: Color(0xFF0E7A3E),
    soft: Color(0xFFE6F4EC),
    darkBase: Color(0xFF63C98C),
  );
  static const purchases = SectionAccent(
    base: Color(0xFFC24E0A),
    soft: Color(0xFFFBEADD),
    darkBase: Color(0xFFF2A06B),
  );
  static const insights = SectionAccent(
    base: Color(0xFF4250B8),
    soft: Color(0xFFE8EBFA),
    darkBase: Color(0xFF96A2EC),
  );
  static const administration = SectionAccent(
    base: Color(0xFF5B6B80),
    soft: Color(0xFFEDF1F6),
    darkBase: Color(0xFFAFC0D4),
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

  // Controls sit on the middle step; cards and dialogs keep the roomier
  // ones — one corner language from a text field to a full-screen dialog.
  static BorderRadius get control => BorderRadius.circular(md);
  static BorderRadius get card => BorderRadius.circular(xl);
  static BorderRadius get dialog => BorderRadius.circular(16);
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

/// Depth, kept quiet: two navy-tinted layers (a tight contact shadow
/// plus a wider ambient one). Light enough to read as «lifted», never as
/// decoration — and tinted, because a grey shadow on a blue canvas reads
/// as dirt.
abstract final class AppShadows {
  static const none = <BoxShadow>[];

  static const raised = <BoxShadow>[
    BoxShadow(color: Color(0x140A1E3C), blurRadius: 10, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x0F0A1E3C), blurRadius: 3, offset: Offset(0, 1)),
  ];

  static const overlay = <BoxShadow>[
    BoxShadow(color: Color(0x290A1E3C), blurRadius: 36, offset: Offset(0, 10)),
    BoxShadow(color: Color(0x140A1E3C), blurRadius: 6, offset: Offset(0, 2)),
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
