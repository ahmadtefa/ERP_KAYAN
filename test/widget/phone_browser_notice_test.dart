import 'package:erp_kayan/shared/widgets/phone_browser_notice.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Regression: the web build answered a phone silently, so a person signing in
/// from a phone saw a cramped invoice and read it as the program failing.
/// The banner must appear only where it is true (a browser on a narrow screen),
/// must leave the screens themselves working, and must not come back once it
/// has been dismissed in that session.
void main() {
  Future<void> pump(
    WidgetTester tester, {
    required bool isWeb,
    Size size = const Size(390, 844),
    Locale locale = const Locale('en'),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      wrapWithApp(
        locale: locale,
        child: PhoneBrowserNotice(
          isWeb: isWeb,
          child: const Scaffold(body: Center(child: Text('INVOICE-SCREEN'))),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('warns on a phone-sized browser and keeps the screen usable', (
    tester,
  ) async {
    await pump(tester, isWeb: true);

    expect(
      find.text('This looks like a phone or tablet browser'),
      findsOneWidget,
    );
    expect(
      find.textContaining('KAYAN ERP is laid out for a desktop screen'),
      findsOneWidget,
    );
    expect(find.text('Continue anyway'), findsOneWidget);
    // The warning must not stand in for the program: the screen below it is
    // built and reachable.
    expect(find.text('INVOICE-SCREEN'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('goes away for the session when dismissed', (tester) async {
    await pump(tester, isWeb: true);

    await tester.tap(find.text('Continue anyway'));
    await tester.pumpAndSettle();

    expect(find.text('This looks like a phone or tablet browser'), findsNothing);
    expect(find.text('INVOICE-SCREEN'), findsOneWidget);
  });

  testWidgets('says nothing on a desktop-sized browser', (tester) async {
    await pump(tester, isWeb: true, size: const Size(1440, 900));

    expect(find.text('This looks like a phone or tablet browser'), findsNothing);
    expect(find.text('INVOICE-SCREEN'), findsOneWidget);
  });

  testWidgets('says nothing outside a browser, however narrow', (tester) async {
    await pump(tester, isWeb: false, size: const Size(390, 844));

    expect(find.text('This looks like a phone or tablet browser'), findsNothing);
    expect(find.text('INVOICE-SCREEN'), findsOneWidget);
  });

  testWidgets('speaks Arabic when the program is in Arabic', (tester) async {
    await pump(tester, isWeb: true, locale: const Locale('ar'));

    expect(
      find.text('يبدو أنك تستخدم متصفح هاتف أو جهاز لوحي'),
      findsOneWidget,
    );
    expect(find.text('المتابعة على أي حال'), findsOneWidget);
  });

  // Regression: the longest Arabic sentence next to the dismiss button left
  // the text two characters wide and the banner 366 pixels taller than the
  // phone screen it was warning about.
  for (final width in <double>[320, 360, 390, 430]) {
    testWidgets('the Arabic banner fits a ${width.toInt()} pixel phone', (
      tester,
    ) async {
      await pump(
        tester,
        isWeb: true,
        locale: const Locale('ar'),
        size: Size(width, 700),
      );

      expect(tester.takeException(), isNull);
      expect(find.text('المتابعة على أي حال'), findsOneWidget);
      expect(find.text('INVOICE-SCREEN'), findsOneWidget);
    });
  }

  testWidgets('the banner survives a large accessibility text size', (
    tester,
  ) async {
    await pump(tester, isWeb: true, size: const Size(320, 640));
    await tester.pumpWidget(
      wrapWithApp(
        child: MediaQuery(
          data: const MediaQueryData(
            size: Size(320, 640),
            textScaler: TextScaler.linear(2),
          ),
          child: PhoneBrowserNotice(
            isWeb: true,
            child: const Scaffold(body: Center(child: Text('INVOICE-SCREEN'))),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('INVOICE-SCREEN'), findsOneWidget);
  });
}
