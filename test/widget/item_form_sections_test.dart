import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async => {
    'state': 'ready',
    'branch': {'nameEn': 'Cairo branch', 'nameAr': 'فرع القاهرة'},
    'warehouse': {'id': 'w', 'code': 'MAIN', 'nameEn': 'Main warehouse', 'nameAr': 'المخزن الرئيسي'},
  };
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async =>
      path == '/inventory/warehouses'
          ? [
              {'id': 'w', 'branchId': 'br', 'code': 'MAIN', 'isDefault': true},
            ]
          : [];
}

Future<void> _open(WidgetTester tester, Locale locale, String newLabel) async {
  tester.view.physicalSize = const Size(900, 1300);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_Api()),
        currentUserProvider.overrideWithValue(
          const AppUser(
            id: 'u',
            username: 'u',
            fullName: 'Manager',
            companyId: 'c',
            branchId: 'br',
            permissions: ['inventory.items.create', 'inventory.cost.manage', 'inventory.items.purchaseprice.manage'],
          ),
        ),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown),
      ],
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: ItemsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(newLabel));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the new-item form is grouped under three headings in English', (tester) async {
    await _open(tester, const Locale('en'), 'New item');
    expect(find.text('Item details'), findsOneWidget);
    await tester.ensureVisible(find.text('Prices and tax'));
    expect(find.text('Prices and tax'), findsOneWidget);
    await tester.ensureVisible(find.text('Stock'));
    expect(find.text('Stock'), findsOneWidget);
  });

  testWidgets('the new-item form is grouped under three headings in Arabic', (tester) async {
    await _open(tester, const Locale('ar'), 'صنف جديد');
    expect(find.text('بيانات الصنف'), findsOneWidget);
    await tester.ensureVisible(find.text('الأسعار والضريبة'));
    expect(find.text('الأسعار والضريبة'), findsOneWidget);
    await tester.ensureVisible(find.text('المخزون'));
    expect(find.text('المخزون'), findsOneWidget);
  });
}
