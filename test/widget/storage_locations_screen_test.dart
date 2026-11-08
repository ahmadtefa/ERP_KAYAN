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

/// Answers the two endpoints the screen reads, and records what was asked for
/// so a test can prove the location request was narrowed to one warehouse.
class _LocationsApi extends ApiClient {
  _LocationsApi({this.failTree = false, this.noWarehouses = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool failTree;
  bool noWarehouses;
  final locationQueries = <Map<String, dynamic>?>[];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') {
      if (noWarehouses) return const [];
      return [
        {
          'id': 'wh-1',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
          'isActive': true,
        },
        {
          'id': 'wh-2',
          'code': 'BR2',
          'nameEn': 'Second store',
          'nameAr': 'المخزن الثاني',
          'isActive': true,
        },
      ];
    }
    if (path == '/inventory/locations') {
      locationQueries.add(query);
      if (failTree) throw StateError('LOCATION_LIST_FAILED');
      if (query?['warehouseId'] == 'wh-2') {
        return [
          {
            'id': 'loc-9',
            'code': 'B-01',
            'nameEn': 'Second bin',
            'nameAr': 'خانة ثانية',
            'kind': 'BIN',
            'isActive': true,
            'stock': {'items': 0, 'quantity': '0.0000'},
          },
        ];
      }
      return [
        {
          'id': 'loc-1',
          'code': 'A-01',
          'nameEn': 'Aisle one',
          'nameAr': 'الممر الأول',
          'kind': 'AISLE',
          'isActive': true,
          'stock': {'items': 3, 'quantity': '125.5000'},
        },
        {
          'id': 'loc-2',
          'code': 'Z-01',
          'nameEn': 'Zone one',
          'nameAr': 'المنطقة الأولى',
          'kind': 'ZONE',
          'isActive': false,
          'stock': {'items': 0, 'quantity': '0.0000'},
        },
      ];
    }
    return const [];
  }

  @override
  Future<Map<String, dynamic>> delete(String path) async => const {};
}

void main() {
  Future<void> pump(
    WidgetTester tester,
    _LocationsApi api, {
    Locale locale = const Locale('en'),
    List<String> permissions = const [
      'inventory.warehouses.read',
      'inventory.warehouses.manage',
    ],
  }) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            AppUser(
              id: 'u',
              username: 'u',
              fullName: 'User',
              companyId: 'c',
              permissions: permissions,
            ),
          ),
        ],
        child: MaterialApp(
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: StorageLocationsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('lists the locations of the first warehouse', (tester) async {
    final api = _LocationsApi();
    await pump(tester, api);
    expect(find.text('A-01'), findsOneWidget);
    expect(find.text('Z-01'), findsOneWidget);
    expect(find.text('Aisle one'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the very first request is already narrowed to one warehouse', (
    tester,
  ) async {
    final api = _LocationsApi();
    await pump(tester, api);
    // An unfiltered first request would list every shelf in the company under
    // one picker entry.
    expect(api.locationQueries, isNotEmpty);
    expect(api.locationQueries.first?['warehouseId'], 'wh-1');
  });

  testWidgets('the kind column names the kind in words, not in caps', (
    tester,
  ) async {
    await pump(tester, _LocationsApi());
    expect(find.text('Aisle'), findsOneWidget);
    expect(find.text('Zone'), findsOneWidget);
    expect(find.text('AISLE'), findsNothing);
  });

  testWidgets('stock counts and quantities come out of the nested object', (
    tester,
  ) async {
    await pump(tester, _LocationsApi());
    expect(find.text('3'), findsOneWidget);
    expect(find.textContaining('125.5'), findsOneWidget);
  });

  testWidgets('an inactive location is labelled inactive', (tester) async {
    await pump(tester, _LocationsApi());
    expect(find.text('Active'), findsOneWidget);
    expect(find.text('Inactive'), findsOneWidget);
  });

  testWidgets('choosing the other warehouse re-reads that warehouse', (
    tester,
  ) async {
    final api = _LocationsApi();
    await pump(tester, api);
    expect(find.text('A-01'), findsOneWidget);

    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('BR2 — Second store').last);
    await tester.pumpAndSettle();

    expect(api.locationQueries.last?['warehouseId'], 'wh-2');
    expect(find.text('B-01'), findsOneWidget);
    expect(find.text('A-01'), findsNothing);
  });

  testWidgets('a company with no warehouses is told what to do first', (
    tester,
  ) async {
    await pump(tester, _LocationsApi(noWarehouses: true));
    expect(find.textContaining('No warehouses yet'), findsOneWidget);
    expect(find.text('New location'), findsNothing);
  });

  testWidgets('the manage grant shows the create button and row actions', (
    tester,
  ) async {
    await pump(tester, _LocationsApi());
    expect(find.text('New location'), findsOneWidget);
    expect(find.byTooltip('Edit'), findsNWidgets(2));
    expect(find.byTooltip('Delete'), findsNWidgets(2));
  });

  testWidgets('a read-only grant hides create, edit and delete', (
    tester,
  ) async {
    await pump(
      tester,
      _LocationsApi(),
      permissions: const ['inventory.warehouses.read'],
    );
    expect(find.text('A-01'), findsOneWidget);
    expect(find.text('New location'), findsNothing);
    expect(find.byTooltip('Edit'), findsNothing);
    expect(find.byTooltip('Delete'), findsNothing);
  });

  testWidgets('deleting asks first and explains that stock is not touched', (
    tester,
  ) async {
    await pump(tester, _LocationsApi());
    await tester.tap(find.byTooltip('Delete').first);
    await tester.pumpAndSettle();
    expect(find.textContaining('Stock recorded against it is not touched'),
        findsOneWidget);
    // Nothing has been sent yet.
    expect(find.text('A-01'), findsOneWidget);
  });

  testWidgets('a failed location list shows the error view with a retry', (
    tester,
  ) async {
    await pump(tester, _LocationsApi(failTree: true));
    expect(find.textContaining('LOCATION_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic names the screen and mirrors its direction', (
    tester,
  ) async {
    await pump(tester, _LocationsApi(), locale: const Locale('ar'));
    expect(find.text('مواقع التخزين'), findsOneWidget);
    expect(find.text('الممر الأول'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('الممر الأول'))),
      TextDirection.rtl,
    );
  });

  testWidgets('the header names the module and offers a way back', (
    tester,
  ) async {
    await pump(tester, _LocationsApi());
    expect(find.text('Storage locations'), findsOneWidget);
    expect(find.text('INVENTORY'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
  });
}
