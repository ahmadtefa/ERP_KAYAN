import 'package:flutter/material.dart';

/// The Al-Marwa emblem. Light theme uses the clean original; dark theme
/// uses the variant made from his black-background original. Pass
/// [forceLight] where the emblem sits on a white tile in either theme.
class BrandEmblem extends StatelessWidget {
  const BrandEmblem({
    super.key,
    this.size,
    this.width,
    this.forceLight = false,
    this.full = false,
  });

  final double? size;

  /// Overrides the width when it must differ from [size] (the full logo is
  /// wider than it is tall).
  final double? width;
  final bool forceLight;

  /// Emblem plus the English name "AL-MARWA". Used only where the English
  /// name fits (login hero, About, installer); icons and the sidebar use
  /// the emblem alone.
  final bool full;

  static const lightAsset = 'assets/branding/almarwa-emblem.png';
  static const darkAsset = 'assets/branding/almarwa-emblem-dark.png';
  static const fullLightAsset = 'assets/branding/almarwa-logo-full.png';
  static const fullDarkAsset = 'assets/branding/almarwa-logo-full-dark.png';

  @override
  Widget build(BuildContext context) {
    final dark = !forceLight && Theme.of(context).brightness == Brightness.dark;
    return Image.asset(
      full
          ? (dark ? fullDarkAsset : fullLightAsset)
          : (dark ? darkAsset : lightAsset),
      width: width ?? size,
      height: size,
      fit: BoxFit.contain,
      excludeFromSemantics: true,
    );
  }
}
