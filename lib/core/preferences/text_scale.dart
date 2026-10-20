/// The user's text size, shared by the theme, the screens and the storage.
///
/// Stored as one number (1.0 = the design's own size) rather than as a set of
/// per-screen sizes: the whole program reads it from here, so a change made in
/// settings reaches every table, dialog and menu without touching them.
library;

const double kDefaultTextScale = 1.0;
const double kMinTextScale = 0.9;
const double kMaxTextScale = 1.4;

/// The steps offered in the settings screen, from smallest to largest.
///
/// The design's own size is one of them, so "100%" is a size a person can
/// pick, not only a state they can return to with the reset button.
const List<double> kTextScaleSteps = <double>[0.9, 1.0, 1.05, 1.15, 1.25, 1.4];

/// Keeps a stored value inside the supported range and to two decimals.
///
/// A stored value from a future version (or a corrupted preferences file) must
/// never make the interface unusable, so anything outside the range is
/// clamped instead of trusted.
double normalizeTextScale(double value) {
  if (value.isNaN || value.isInfinite) return kDefaultTextScale;
  if (value <= 0) return kDefaultTextScale;
  final clamped = value < kMinTextScale
      ? kMinTextScale
      : (value > kMaxTextScale ? kMaxTextScale : value);
  return double.parse(clamped.toStringAsFixed(2));
}

/// The next offered step in [direction] (+1 larger, -1 smaller), or null when
/// the end of the range has been reached.
double? stepTextScale(double current, int direction) {
  final value = normalizeTextScale(current);
  if (direction > 0) {
    for (final step in kTextScaleSteps) {
      if (step > value + 0.001) return step;
    }
    return value >= kMaxTextScale - 0.001 ? null : kMaxTextScale;
  }
  for (final step in kTextScaleSteps.reversed) {
    if (step < value - 0.001) return step;
  }
  return value <= kMinTextScale + 0.001 ? null : kMinTextScale;
}

/// The label shown next to the current size, e.g. `115%`.
String textScalePercent(double scale) => '${(normalizeTextScale(scale) * 100).round()}%';
