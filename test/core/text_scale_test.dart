import 'package:erp_kayan/core/preferences/text_scale.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('text scale values', () {
    test('a stored value outside the range is clamped, not trusted', () {
      expect(normalizeTextScale(0.1), kMinTextScale);
      expect(normalizeTextScale(9), kMaxTextScale);
      expect(normalizeTextScale(0), kDefaultTextScale);
      expect(normalizeTextScale(-2), kDefaultTextScale);
      expect(normalizeTextScale(double.nan), kDefaultTextScale);
      expect(normalizeTextScale(double.infinity), kDefaultTextScale);
    });

    test('a stored value is rounded to two decimals', () {
      expect(normalizeTextScale(1.23456), 1.23);
      expect(normalizeTextScale(1.0), 1.0);
    });

    test('stepping walks the offered sizes and stops at the ends', () {
      expect(stepTextScale(1.0, 1), 1.05);
      expect(stepTextScale(1.05, -1), 1.0);
      expect(stepTextScale(1.05, 1), 1.15);
      expect(stepTextScale(1.15, -1), 1.05);
      expect(stepTextScale(0.9, -1), isNull);
      expect(stepTextScale(1.4, 1), isNull);
    });

    test('a value between the offered sizes still moves to the next one', () {
      // A value stored by an older build, or typed by hand, must not trap the
      // person between two steps.
      expect(stepTextScale(1.02, 1), 1.05);
      expect(stepTextScale(1.02, -1), 1.0);
      expect(stepTextScale(1.1, 1), 1.15);
      expect(stepTextScale(1.1, -1), 1.05);
    });

    test('a value above the last step can still come back down', () {
      expect(stepTextScale(1.35, 1), 1.4);
      expect(stepTextScale(1.35, -1), 1.25);
    });

    test('the label is a whole percentage of the normalised value', () {
      expect(textScalePercent(1.0), '100%');
      expect(textScalePercent(1.15), '115%');
      expect(textScalePercent(1.234), '123%');
    });

    test('the default size is one of the offered steps', () {
      expect(kTextScaleSteps, contains(kDefaultTextScale));
      expect(kTextScaleSteps.first, kMinTextScale);
      expect(kTextScaleSteps.last, kMaxTextScale);
    });
  });
}
