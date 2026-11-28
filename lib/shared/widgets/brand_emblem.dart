import 'package:flutter/material.dart';

/// The Al-Marwa emblem. Light theme uses the clean original; dark theme
/// uses the variant made from his black-background original. Pass
/// [forceLight] where the emblem sits on a white tile in either theme.
class BrandEmblem extends StatelessWidget {
  const BrandEmblem({
    super.key,
    this.size,
    this.forceLight = false,
  });

  final double? size;
  final bool forceLight;

  static const lightAsset = 'assets/branding/almarwa-emblem.png';
  static const darkAsset = 'assets/branding/almarwa-emblem-dark.png';

  @override
  Widget build(BuildContext context) {
    final dark = !forceLight && Theme.of(context).brightness == Brightness.dark;
    return Image.asset(
      dark ? darkAsset : lightAsset,
      width: size,
      height: size,
      fit: BoxFit.contain,
      excludeFromSemantics: true,
    );
  }
}
