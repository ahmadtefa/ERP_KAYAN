import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  Future<void> pumpShell(WidgetTester tester, Locale locale) async {
    tester.view.physicalSize = const Size(1366, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tokenStoreProvider.overrideWithValue(FakeTokenStore()),
          authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
        ],
        child: wrapWithApp(
          locale: locale,
          child: const ErpShell(
            currentPath: AppRoutes.dashboard,
            child: SizedBox.expand(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('English lays the navigation out on the left', (tester) async {
    await pumpShell(tester, const Locale('en'));

    final nav = find.byKey(const Key('erp-shell-nav-list'));
    expect(nav, findsOneWidget);
    expect(tester.getRect(nav).left, closeTo(0.0, 1.0));
    expect(
      Directionality.of(tester.element(nav)),
      TextDirection.ltr,
    );
    expect(find.text('Dashboard'), findsWidgets);
  });

  testWidgets('Arabic lays the navigation out on the right', (tester) async {
    await pumpShell(tester, const Locale('ar'));

    final nav = find.byKey(const Key('erp-shell-nav-list'));
    expect(nav, findsOneWidget);
    expect(tester.getRect(nav).right, closeTo(1366.0, 1.0));
    expect(
      Directionality.of(tester.element(nav)),
      TextDirection.rtl,
    );
    expect(find.text('لوحة التحكم'), findsWidgets);
  });
}
