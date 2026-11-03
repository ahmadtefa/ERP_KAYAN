import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('light and dark themes use the bundled Arabic font for text', () {
    for (final theme in [AppTheme.light(), AppTheme.dark()]) {
      expect(theme.textTheme.bodyMedium?.fontFamily, 'IBMPlexSansArabic');
      expect(theme.textTheme.titleLarge?.fontFamily, 'IBMPlexSansArabic');
    }
  });
}
