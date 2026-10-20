import 'package:flutter/widgets.dart';

import '../../core/preferences/text_scale.dart';

/// Applies the user's text size to everything below [context], exactly once.
///
/// [MediaQuery.textScaler] is the one place Flutter honours a text size for
/// every widget, including the many labels that draw with an explicit
/// `fontSize` and never consult the [TextTheme]. The theme keeps its design
/// sizes untouched; this replaces the ambient scaler instead of multiplying
/// the theme by the factor as well, so rebuilding the app cannot compound the
/// size.
///
/// The platform's own accessibility scale (Windows display scaling, a phone's
/// font setting) is folded in once: [base] is read from the context *above*
/// this override, and our factor multiplies it.
Widget applyTextScale(BuildContext context, Widget? child, double scale) {
  final media = MediaQuery.of(context);
  final platform = media.textScaler.scale(1.0);
  final base = platform.isFinite && platform > 0 ? platform : 1.0;
  final effective = base * normalizeTextScale(scale);
  return MediaQuery(
    data: media.copyWith(
      textScaler: effective == 1.0
          ? TextScaler.noScaling
          : TextScaler.linear(effective),
    ),
    child: child ?? const SizedBox.shrink(),
  );
}
