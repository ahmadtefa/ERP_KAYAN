import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/warehouses_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _WarehousesApi extends ApiClient {
  _WarehousesApi({this.rows = const []})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final List<Map<String, dynamic>> rows;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') return rows;
    if (path == '/company/branches') {
      return [
        {'id': 'br-1', 'code': 'BR1', 'nameEn': 'Main branch'},
      ];
    }
    return const [];
  }
}

const _user = AppUser(
  id: 'u',
  username: 'u',
  fullName: 'User',
  companyId: 'c',
  isSuperAdmin: true,
);

Future<void> _pump(WidgetTester tester, List<Map<String, dynamic>> rows) async {
  tester.view.physicalSize = const Size(1600, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_WarehousesApi(rows: rows)),
        currentUserProvider.overrideWithValue(_user),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: WarehousesScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('an empty warehouse list says what happened and the next step', (
    tester,
  ) async {
    await _pump(tester, const []);

    expect(find.textContaining('No warehouses to show'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the warehouse form groups its fields under short headings', (
    tester,
  ) async {
    await _pump(tester, [
      {
        'id': 'wh-1',
        'code': 'MAIN',
        'nameEn': 'Main store',
        'nameAr': 'المخزن الرئيسي',
        'branchId': 'br-1',
        'isActive': true,
        'isDefault': true,
      },
    ]);

    await tester.tap(find.text('New warehouse'));
    await tester.pumpAndSettle();

    expect(find.text('Warehouse details'), findsOneWidget);
    expect(find.text('Branch'), findsWidgets);
    expect(find.text('Address'), findsWidgets);
    expect(find.text('Setting'), findsOneWidget);
    expect(
      find.text('Stock and access are counted inside this branch.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
