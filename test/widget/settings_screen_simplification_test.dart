import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/settings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

const _admin = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'fixture-company',
  isSuperAdmin: true,
);

void _size(WidgetTester tester) {
  tester.view.physicalSize = const Size(1500, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('settings groups the signed-in details under a heading', (
    tester,
  ) async {
    _size(tester);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [currentUserProvider.overrideWithValue(_admin)],
        child: wrapWithApp(child: const Scaffold(body: SettingsScreen())),
      ),
    );
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('Your account'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
