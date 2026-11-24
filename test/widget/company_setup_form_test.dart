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

  testWidgets('setup marks each invalid field and clears only the edited reason', (tester) async {
    tester.view.physicalSize = const Size(1400, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var sent = 0;
    await tester.pumpWidget(wrapWithApp(child: Scaffold(
      body: SingleChildScrollView(child: CompanySetupForm(onSubmit: (_) async { sent++; })),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();
    expect(sent, 0);
    expect(find.textContaining('Use 2-20'), findsOneWidget);
    expect(find.textContaining('Name is required'), findsNWidgets(2));
    expect(find.textContaining('Username needs 3-60'), findsOneWidget);
    expect(find.textContaining('Password needs 8-200'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'كود الشركة * / Code *'), 'CO');
    await tester.pump();
    expect(find.textContaining('Use 2-20'), findsNothing);
    expect(find.textContaining('Name is required'), findsNWidgets(2));
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
