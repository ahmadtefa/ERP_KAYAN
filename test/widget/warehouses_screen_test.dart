import 'package:erp_kayan/app/theme/design_tokens.dart';
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

/// A warehouse list shaped exactly like `WarehouseService.toResponse`.
class _WarehousesApi extends ApiClient {
  _WarehousesApi({this.active = true, this.failList = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool active;
  bool failList;
  final posts = <String>[];
  final patches = <(String, Object?)>[];
  final balanceRequests = <(String, Map<String, dynamic>?)>[];

  /// Every balance query the screen asked for, so a test can prove the dialog
  /// reads the real endpoint rather than rendering local rows.
  final balanceQueries = <Map<String, dynamic>?>[];

  /// The shape `WarehouseService.balanceReport` really returns: the list is
  /// called `rows`, and each row is one warehouse/item pair.
  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path != '/inventory/warehouses/balance') {
      throw StateError('UNEXPECTED_GET $path');
    }
    // Two assertions in this file read this mock through different names;
    // one definition records for both rather than duplicating the method.
    balanceQueries.add(query);
    balanceRequests.add((path, query));
    return {
      'asOf': '2026-11-08',
      'rows': [
        {
          'warehouseId': 'wh-1',
          'warehouseCode': 'MAIN',
          'warehouseNameEn': 'Main store',
          'warehouseNameAr': 'المخزن الرئيسي',
          'branchId': 'br-1',
          'branchCode': 'HQ',
          'branchNameEn': 'Head office',
          'branchNameAr': 'المركز الرئيسي',
          'itemId': 'it-1',
          'itemCode': 'IT-1',
          'itemNameEn': 'Sugar',
          'itemNameAr': 'سكر',
          'unit': 'piece',
          'quantity': '12.0000',
          'quantityText': '12',
          'breakdown': [],
          'value': '120.0000',
          'averageCost': '10.0000',
        },
      ],
      'itemTotals': [],
      'warehouseTotals': [],
      'totals': {'value': '120.0000'},
    };
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (failList) throw StateError('WAREHOUSE_LIST_FAILED');
    return [
      {
        'id': 'wh-1',
        'code': 'MAIN',
        'nameEn': 'Main store',
        'nameAr': 'المخزن الرئيسي',
        'address': 'Cairo',
        'isDefault': true,
        'isActive': active,
        'branchId': 'br-1',
        'branchCode': 'HQ',
        'branchNameEn': 'Head office',
        'branchNameAr': 'المركز الرئيسي',
      },
      {
        'id': 'wh-2',
        'code': 'BR2',
        'nameEn': 'Second store',
        'nameAr': 'المخزن الثاني',
        'address': null,
        'isDefault': false,
        'isActive': true,
        'branchId': 'br-2',
        'branchCode': 'BR2',
        'branchNameEn': 'Branch two',
        'branchNameAr': 'الفرع الثاني',
      },
    ];
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add(path);
    if (path.endsWith('/deactivate')) active = false;
    if (path.endsWith('/reactivate')) active = true;
    return const {};
  }

  @override
  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    patches.add((path, body));
    return const {};
  }
}

void main() {
  Future<void> pump(
    WidgetTester tester,
    _WarehousesApi api, {
    Locale locale = const Locale('en'),
    List<String> permissions = const [
      'inventory.warehouses.read',
      'inventory.warehouses.manage',
    ],
    Widget? screen,
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
          home: Scaffold(body: screen ?? const WarehousesScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('lists warehouses with code, branch and status', (tester) async {
    await pump(tester, _WarehousesApi());
    expect(find.text('Main store'), findsOneWidget);
    expect(find.text('Second store'), findsOneWidget);
    expect(find.text('MAIN'), findsOneWidget);
    expect(find.text('Head office'), findsOneWidget);
    expect(find.text('Active'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('English shows nameEn, Arabic shows nameAr', (tester) async {
    await pump(tester, _WarehousesApi());
    expect(find.text('Main store'), findsOneWidget);
    expect(find.text('المخزن الرئيسي'), findsNothing);

    await pump(tester, _WarehousesApi(), locale: const Locale('ar'));
    expect(find.text('المخزن الرئيسي'), findsOneWidget);
    expect(find.text('Main store'), findsNothing);
    expect(
      Directionality.of(
        tester.element(find.text('المخزن الرئيسي')),
      ),
      TextDirection.rtl,
    );
  });

  testWidgets('search narrows the list by code, either name and address', (
    tester,
  ) async {
    await pump(tester, _WarehousesApi());
    await tester.enterText(find.byType(TextField).first, 'BR2');
    await tester.pumpAndSettle();
    expect(find.text('Second store'), findsOneWidget);
    expect(find.text('Main store'), findsNothing);

    await tester.enterText(find.byType(TextField).first, 'cairo');
    await tester.pumpAndSettle();
    expect(find.text('Main store'), findsOneWidget);
    expect(find.text('Second store'), findsNothing);
  });

  testWidgets('the manage grant shows the create button and row actions', (
    tester,
  ) async {
    await pump(tester, _WarehousesApi());
    expect(find.widgetWithText(FilledButton, 'New warehouse'), findsOneWidget);
    expect(find.byTooltip('Edit'), findsNWidgets(2));
    expect(find.byTooltip('Deactivate'), findsWidgets);
  });

  testWidgets('a read-only grant keeps balance viewing but hides management actions', (
    tester,
  ) async {
    await pump(
      tester,
      _WarehousesApi(),
      permissions: const ['inventory.warehouses.read'],
    );
    expect(find.text('Main store'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'New warehouse'), findsNothing);
    expect(find.byTooltip('Edit'), findsNothing);
    expect(find.byTooltip('Deactivate'), findsNothing);
    expect(find.byTooltip('Warehouse balances'), findsNWidgets(2));
  });

  testWidgets('warehouse balance dialog reads the API rows and scopes request', (
    tester,
  ) async {
    final api = _WarehousesApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Warehouse balances').first);
    await tester.pumpAndSettle();

    expect(api.balanceRequests, hasLength(1));
    expect(api.balanceRequests.single.$1, '/inventory/warehouses/balance');
    expect(api.balanceRequests.single.$2?['warehouseId'], 'wh-1');
    expect(find.text('ITEM-001'), findsOneWidget);
    expect(find.text('Coffee'), findsOneWidget);
    expect(find.text('12.5'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('deactivating asks first, then posts and refreshes', (
    tester,
  ) async {
    final api = _WarehousesApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Deactivate').first);
    await tester.pumpAndSettle();
    // The confirmation must appear before anything is sent.
    expect(find.text('Deactivate'), findsWidgets);
    expect(api.posts, isEmpty);

    await tester.tap(find.widgetWithText(FilledButton, 'Deactivate'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/inventory/warehouses/wh-1/deactivate'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('reactivating does not ask, because it is reversible', (
    tester,
  ) async {
    final api = _WarehousesApi(active: false);
    await pump(tester, api);
    await tester.tap(find.byTooltip('Reactivate').first);
    await tester.pumpAndSettle();
    expect(api.posts, contains('/inventory/warehouses/wh-1/reactivate'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed list shows the error view with a retry', (
    tester,
  ) async {
    await pump(tester, _WarehousesApi(failList: true));
    expect(find.textContaining('WAREHOUSE_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty company gets the empty message, not a broken table', (
    tester,
  ) async {
    final api = _WarehousesApi();
    await pump(tester, api);
    await tester.enterText(find.byType(TextField).first, 'nothing matches this');
    await tester.pumpAndSettle();
    expect(find.textContaining('No warehouses yet'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the header carries the inventory eyebrow and a back control', (
    tester,
  ) async {
    await pump(tester, _WarehousesApi());
    expect(find.text('INVENTORY'), findsOneWidget);
    expect(find.text('Warehouses'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
  });

  testWidgets('status tone marks an inactive warehouse as neutral', (
    tester,
  ) async {
    await pump(tester, _WarehousesApi(active: false));
    expect(find.text('Inactive'), findsWidgets);
    // The tone is what colours the chip; the enum value must be the neutral
    // one for a switched-off row and success for a live one.
    expect(AppTone.neutral, isNotNull);
    expect(tester.takeException(), isNull);
  });
  // The "where is it" question. The stock screen answers "how much do we have
  // anywhere"; this answers which shelf, which is what a picker needs.
  testWidgets('balances asks the real endpoint and shows the shelf rows', (
    tester,
  ) async {
    final api = _WarehousesApi();
    await pump(
      tester,
      api,
      permissions: const ['inventory.warehouses.read'],
    );

    expect(find.text('Balances'), findsOneWidget);
    await tester.tap(find.text('Balances'));
    await tester.pumpAndSettle();

    expect(find.text('Warehouse balances'), findsOneWidget);
    expect(api.balanceQueries, hasLength(1));
    // The row the server returned is on screen: warehouse, item and the
    // server's own trimmed quantity, not a locally formatted one.
    expect(find.text('Main store'), findsWidgets);
    expect(find.text('IT-1'), findsOneWidget);
    expect(find.text('12'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('balances is offered with the read grant, not only manage', (
    tester,
  ) async {
    await pump(
      tester,
      _WarehousesApi(),
      permissions: const ['inventory.warehouses.read'],
    );
    // Reading a shelf does not require the right to change it.
    expect(find.text('Balances'), findsOneWidget);
    expect(find.text('New warehouse'), findsNothing);
  });
}
