import 'package:erp_kayan/shared/widgets/company_setup_form.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

/// Regression: the setup form used a fixed Row (logo picker) and three fixed
/// Expanded fields, which overflowed on narrow surfaces. Every width below must
/// lay out with no exception, in both the sign-in gate and a plain page.
void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  for (final width in <double>[320, 400, 600, 800]) {
    testWidgets('company setup form has no overflow at ${width.toInt()} px', (
      tester,
    ) async {
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapWithApp(
          child: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: CompanySetupForm(onSubmit: (_) async {}),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('اختيار صورة / Choose image'), findsOneWidget);
      expect(find.byType(TextField), findsWidgets);
    });
  }
}
