import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/storage_locations_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _StorageApi extends ApiClient {
  _StorageApi({this.warehouses = const []})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final List<Map<String, dynamic>> warehouses;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') return warehouses;
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

Future<void> _pump(
  WidgetTester tester,
  List<Map<String, dynamic>> warehouses,
) async {
  tester.view.physicalSize = const Size(1600, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_StorageApi(warehouses: warehouses)),
        currentUserProvider.overrideWithValue(_user),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: StorageLocationsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('no warehouse means the empty state names the next step', (
    tester,
  ) async {
    await _pump(tester, const []);

    expect(find.textContaining('No warehouses yet'), findsOneWidget);
    expect(find.textContaining('Create a warehouse first'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the location form groups its fields under short headings', (
    tester,
  ) async {
    await _pump(tester, [
      {'id': 'wh-1', 'code': 'MAIN', 'nameEn': 'Main store', 'nameAr': 'المخزن'},
    ]);

    await tester.tap(find.text('New location'));
    await tester.pumpAndSettle();

    expect(find.text('Location details'), findsOneWidget);
    expect(find.text('Kind and parent'), findsOneWidget);
    expect(
      find.text('The kind decides what may sit above and below it in the warehouse.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
