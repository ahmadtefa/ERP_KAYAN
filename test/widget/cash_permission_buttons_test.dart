import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/cash/presentation/screens/cash_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async => [];
  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async => {'items': <Object>[], 'rows': <Object>[]};
}

Future<void> _open(WidgetTester tester, AppUser user) async {
  tester.view.physicalSize = const Size(1700, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(_Api()),
      currentUserProvider.overrideWithValue(user),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown),
    ],
    child: MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: const Scaffold(body: CashScreen()),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  const readOnly = AppUser(
    id: 'u2',
    username: 'viewer',
    fullName: 'Viewer',
    companyId: 'company-1',
    branchId: 'branch-1',
    permissions: ['cash.accounts.read', 'cash.vouchers.read'],
  );

  testWidgets('a read-only user sees no create button on the cash boxes or vouchers', (tester) async {
    await _open(tester, readOnly);
    expect(find.widgetWithText(FilledButton, 'New box or bank'), findsNothing);
    await tester.tap(find.text('Receipts & payments'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'New receipt or payment'), findsNothing);
  });

  testWidgets('a user with the manage and create permissions sees the buttons', (tester) async {
    await _open(
      tester,
      const AppUser(
        id: 'u3',
        username: 'cashier',
        fullName: 'Cashier',
        companyId: 'company-1',
        branchId: 'branch-1',
        permissions: ['cash.accounts.read', 'cash.accounts.manage', 'cash.vouchers.read', 'cash.vouchers.create'],
      ),
    );
    expect(find.widgetWithText(FilledButton, 'New box or bank'), findsOneWidget);
    await tester.tap(find.text('Receipts & payments'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(FilledButton, 'New receipt or payment'), findsOneWidget);
  });
}
