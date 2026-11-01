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
  static const textSecondary = Color(0xFF4F6079);
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

  // The steps used for *words* on the soft chips above. The drawing steps are
  // fine for a dot, a rule or a 20-pixel icon, but at 10.5 pixels a label in
  // #12805C on #E6F4EE measures 4.34:1 and a red one 4.15:1 - under the 4.5:1
  // that small text needs. These are the same hues, stepped down until each
  // pair measures at least 5:1; the strong steps keep drawing icons.
  static const successText = Color(0xFF0C6146);
  static const warningText = Color(0xFF825603);
  static const errorText = Color(0xFFB71C14);

  // And the same meanings on the dark canvas, where a deep green or the brand
  // blue measures 2.8-3.4:1 against #111E33: unreadable at any size.
  static const successTextDark = Color(0xFF4CC79A);
  static const warningTextDark = Color(0xFFE3B25E);
  static const errorTextDark = Color(0xFFF19A93);
  static const infoTextDark = Color(0xFF7FA9F5);

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

/// One section's identity colour.
///
/// Five steps, because a section identity is used in five different jobs and
/// the same hex cannot do all of them without failing somewhere:
///
///  * [base]      — the strong step: icons, the selected marker, headings.
///  * [soft]      — the chip behind [base] (selected menu tile, tag).
///  * [pageTint]  — the canvas of that section's screens: a wash of the
///    section colour light enough to read body text on, strong enough that
///    «المبيعات» and «المشتريات» are not the same white page.
///  * [panelTint] — a slightly stronger wash for headers and grouped panels.
///  * [darkBase]  — the same hue stepped up for the dark canvas.
///
/// Every pair in use is measured by `test/shared/design_contrast_test.dart`:
/// [base] on [soft], on white and on [pageTint] clears 4.5:1, and the ordinary
/// body/secondary inks clear 4.5:1 on [pageTint], so a tinted section is not a
/// prettier way to make a screen hard to read.
class SectionAccent {
  const SectionAccent({
    required this.base,
    required this.soft,
    required this.pageTint,
    required this.panelTint,
    required this.darkBase,
  });

  final Color base;
  final Color soft;
  final Color pageTint;
  final Color panelTint;
  final Color darkBase;

  Color of(Brightness brightness) =>
      brightness == Brightness.dark ? darkBase : base;

  Color softOf(Brightness brightness) => brightness == Brightness.dark
      ? darkBase.withValues(alpha: 0.18)
      : soft;

  /// The canvas this section's screens sit on. In the dark theme the tint is
  /// the product's dark canvas: a washed-out blue behind dark cards would
  /// destroy the figure/text contrast the dark theme exists to keep.
  Color pageOf(Brightness brightness) =>
      brightness == Brightness.dark ? AppColors.darkBackground : pageTint;

  /// The band behind a section header or a grouped panel.
  Color panelOf(Brightness brightness) => brightness == Brightness.dark
      ? AppColors.darkSurfaceAlt
      : panelTint;
}

/// The colour of each main section of the product.
///
/// The owner's brief names a colour per department, and this is that table
/// implemented in one place: the navigation, the top bar, the page canvas and
/// the dashboard figures all read from here, so «المشتريات» is orange on the
/// menu, on its own screens and in the charts — not only in its icon.
///
/// The values are the brief's hues stepped until they pass contrast (see
/// [SectionAccent]); a hue that reads nicely on a swatch can be 3.2:1 behind
/// 13-pixel text, which is how a colourful menu becomes an unreadable one.
///
/// The identity follows the *job*, not the API module: banks and cashboxes are
/// their own daily destination and carry the accounting emerald, while
/// customers (turquoise) and suppliers (violet) are deliberately different
/// colours so a payment to a supplier is never mistaken for one from a
/// customer at a glance.
abstract final class SectionAccents {
  // Every identity colour in this table is held to two measurements at once:
  // 5.8:1 or better on white (so it can headline a section and label a table
  // column) and 2.8:1 or better on the navy sidebar (so the same colour is the
  // selected entry's marker without being a lighter second colour). That band
  // - luminance around 0.13 - is what makes one value usable in both places,
  // and it is why "deep blue" here reads as indigo rather than as near-black.
  //
  // The canvas behind each section is a wash of the same hue: the page tint is
  // the palest step, the panel tint one step deeper so a grouped area reads as
  // a band rather than as a change of page. Every pair of page tints is a
  // measurably different colour, because two sections a person cannot tell
  // apart at a glance are two sections that may as well share a colour.

  /// لوحة التحكم — azure.
  static const overview = SectionAccent(
    base: Color(0xFF1563BD),
    soft: Color(0xFFE8EFF8),
    pageTint: Color(0xFFF1F6FB),
    panelTint: Color(0xFFE1EBF6),
    darkBase: Color(0xFF569FF1),
  );

  /// المحاسبة — emerald.
  static const accounting = SectionAccent(
    base: Color(0xFF13724F),
    soft: Color(0xFFE7F1ED),
    pageTint: Color(0xFFF3F8F6),
    panelTint: Color(0xFFE3EEEA),
    darkBase: Color(0xFF17B57B),
  );

  /// Banks & cashboxes sit inside accounting and share its emerald — cash is
  /// where the accounting numbers are actually touched, not a different book.
  /// Its canvas is a deeper wash of the same green, so «الخزينة» still looks
  /// like its own desk rather than like a copy of the ledger.
  static const cash = SectionAccent(
    base: Color(0xFF13724F),
    soft: Color(0xFFE7F1ED),
    pageTint: Color(0xFFE9F2EE),
    panelTint: Color(0xFFD9E8E2),
    darkBase: Color(0xFF17B57B),
  );

  /// العملاء — turquoise.
  static const customers = SectionAccent(
    base: Color(0xFF177067),
    soft: Color(0xFFE8F1F0),
    pageTint: Color(0xFFECF4F3),
    panelTint: Color(0xFFDCEAE8),
    darkBase: Color(0xFF1EAEA0),
  );

  /// الموردون — violet, kept well away from the customers' turquoise and the
  /// reports' indigo so a payment to a supplier never looks like one from a
  /// customer.
  static const suppliers = SectionAccent(
    base: Color(0xFF8B33D8),
    soft: Color(0xFFF3EBFB),
    pageTint: Color(0xFFF8F3FD),
    panelTint: Color(0xFFF0E4FA),
    darkBase: Color(0xFFBB84EC),
  );

  /// المخازن والأصناف — teal blue.
  static const inventory = SectionAccent(
    base: Color(0xFF166D87),
    soft: Color(0xFFE8F0F3),
    pageTint: Color(0xFFEFF5F7),
    panelTint: Color(0xFFDEEBEE),
    darkBase: Color(0xFF1BA8D2),
  );

  /// المبيعات وعروض الأسعار — royal blue.
  static const sales = SectionAccent(
    base: Color(0xFF3B52E9),
    soft: Color(0xFFEBEEFD),
    pageTint: Color(0xFFEDEFFD),
    panelTint: Color(0xFFDEE2FB),
    darkBase: Color(0xFF8695F5),
  );

  /// المشتريات — warm orange.
  static const purchases = SectionAccent(
    base: Color(0xFFAD420D),
    soft: Color(0xFFF7ECE7),
    pageTint: Color(0xFFFBF6F3),
    panelTint: Color(0xFFF5E8E2),
    darkBase: Color(0xFFF57738),
  );

  /// التقارير — indigo, deeper in hue than sales and further from the
  /// customers' turquoise than a navy would be at this luminance.
  static const insights = SectionAccent(
    base: Color(0xFF684FCC),
    soft: Color(0xFFF0EDFA),
    pageTint: Color(0xFFF2F1FB),
    panelTint: Color(0xFFE7E3F7),
    darkBase: Color(0xFFA090E3),
  );

  /// الإدارة والإعدادات — slate, because administration is not a business
  /// department and should not compete with one.
  static const administration = SectionAccent(
    base: Color(0xFF56657B),
    soft: Color(0xFFEEF0F2),
    pageTint: Color(0xFFF1F3F4),
    panelTint: Color(0xFFE6E8EB),
    darkBase: Color(0xFF8A9DB6),
  );
}

/// The product's typeface.
///
/// One family, bundled with the program: IBM Plex Sans Arabic, whose Latin is
/// drawn to the same metrics as its Arabic, so a line that mixes «إجمالي 1,250
/// EGP» does not change rhythm halfway. Weights 400/500/600/700 are registered
/// in `pubspec.yaml`; the theme uses only those, because a synthesised bold is
/// a smeared glyph, not a weight.
///
/// The fallbacks matter for one reason: if the bundled files were ever missing
/// from a build, Arabic must still be Arabic (never tofu) rather than a
/// Latin-only face that renders empty boxes.
abstract final class AppTypography {
  static const arabicFamily = 'IBMPlexSansArabic';
  static const latinFamily = 'IBMPlexSansArabic';
  static const fallback = <String>[
    'Segoe UI',
    'Tahoma',
    'Noto Sans Arabic',
    'Arial',
  ];

  /// Tabular figures for money columns.
  ///
  /// A column of prices has to line up on the decimal point; proportional
  /// digits (where "1" is narrower than "8") make a figure column look ragged
  /// and make a mis-keyed digit harder to spot. Money and quantity cells use
  /// this, prose does not.
  static const tnum = <FontFeature>[FontFeature.tabularFigures()];
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
  /// The light-theme ink for this meaning, measured on [background].
  Color get foreground => switch (this) {
    AppTone.neutral => AppColors.textSecondary,
    AppTone.info => AppColors.primary,
    AppTone.success => AppColors.successText,
    AppTone.warning => AppColors.warningText,
    AppTone.danger => AppColors.errorText,
  };

  /// The light-theme chip behind [foreground].
  Color get background => switch (this) {
    AppTone.neutral => AppColors.surfaceSunken,
    AppTone.info => AppColors.infoSoft,
    AppTone.success => AppColors.successSoft,
    AppTone.warning => AppColors.warningSoft,
    AppTone.danger => AppColors.errorSoft,
  };

  /// The same meaning, drawn on whichever canvas the person is looking at.
  ///
  /// A tone is not a colour: on the dark canvas the success green has to be
  /// the bright step or the words disappear, and the chip behind it has to be
  /// a tint of that step rather than a pale patch from the light theme. Both
  /// answers are pinned by `test/theme/contrast_test.dart`.
  Color foregroundOn(Brightness brightness) {
    if (brightness != Brightness.dark) return foreground;
    return switch (this) {
      AppTone.neutral => AppColors.darkTextMuted,
      AppTone.info => AppColors.infoTextDark,
      AppTone.success => AppColors.successTextDark,
      AppTone.warning => AppColors.warningTextDark,
      AppTone.danger => AppColors.errorTextDark,
    };
  }

  /// [foregroundOn], laid on [surface] as a tint so the chip belongs to the
  /// card it sits on - [AppColors.darkSurface] by default, since that is what
  /// a card inside the dark canvas is painted with.
  Color backgroundOn(
    Brightness brightness, {
    Color? surface,
  }) {
    if (brightness != Brightness.dark) return background;
    return Color.alphaBlend(
      foregroundOn(brightness).withValues(alpha: 0.14),
      surface ?? AppColors.darkSurface,
    );
  }
}
