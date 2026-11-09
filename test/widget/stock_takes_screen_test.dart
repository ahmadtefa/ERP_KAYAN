import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_takes_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Rows shaped like `StockTakesService.toSummary`, which carries the opener's
/// id so the screen can tell whether the caller may approve.
class _StockTakesApi extends ApiClient {
  _StockTakesApi({this.failList = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool failList;
  final posts = <String>[];
  final bodies = <String, Object?>{};
  final Map<String, dynamic> detail = {
    'id': 'st-1',
    'code': 'ST-001',
    'warehouseId': 'wh-1',
    'warehouseNameEn': 'Main store',
    'warehouseNameAr': 'المخزن الرئيسي',
    'status': 'COUNTING',
    'createdBy': 'someone-else',
    'lines': [
      {
        'id': 'line-1',
        'itemId': 'item-1',
        'itemCode': 'ITEM-1',
        'itemNameEn': 'Coffee',
        'itemNameAr': 'قهوة',
        'unit': 'piece',
        'systemQuantity': '10.0000',
        'countedQuantity': null,
        'varianceQuantity': '0.0000',
        'varianceValue': '0.0000',
      },
    ],
  };

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (failList && path == '/inventory/stock-takes') throw StateError('STOCKTAKE_LIST_FAILED');
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'wh-1', 'code': 'MAIN', 'nameEn': 'Main store', 'nameAr': 'المخزن الرئيسي'},
      ];
    }
    if (path == '/inventory/items') {
      return [
        {'id': 'item-1', 'code': 'ITEM-1', 'nameEn': 'Coffee', 'nameAr': 'قهوة'},
      ];
    }
    return [
      {
        'id': 'st-1',
        'code': 'ST-001',
        'branchId': 'br-1',
        'warehouseId': 'wh-1',
        'warehouseCode': 'MAIN',
        'warehouseNameEn': 'Main store',
        'warehouseNameAr': 'المخزن الرئيسي',
        'scope': 'FULL',
        // Reached REVIEW like st-1, but the current user opened it, so the
        // service refuses their approval and the screen explains why.
        'status': 'REVIEW',
        'frozenAt': null,
        'createdBy': 'someone-else',
        'approvedAt': null,
        'approvedBy': null,
        'postedAt': null,
        'documentId': null,
        'journalEntryId': null,
        'lineCount': 12,
        'notes': null,
        'createdAt': '2026-11-05T09:00:00.000Z',
      },
      {
        'id': 'st-2',
        'code': 'ST-002',
        'branchId': 'br-1',
        'warehouseId': 'wh-1',
        'warehouseCode': 'MAIN',
        'warehouseNameEn': 'Main store',
        'warehouseNameAr': 'المخزن الرئيسي',
        'scope': 'PARTIAL',
        'status': 'APPROVED',
        'frozenAt': null,
        'createdBy': 'u',
        'approvedAt': '2026-11-06T10:00:00.000Z',
        'approvedBy': 'someone-else',
        'postedAt': null,
        'documentId': null,
        'journalEntryId': null,
        'lineCount': 4,
        'notes': null,
        'createdAt': '2026-11-04T09:00:00.000Z',
      },
      {
        'id': 'st-3',
        'code': 'ST-003',
        'branchId': 'br-1',
        'warehouseId': 'wh-1',
        'warehouseCode': 'MAIN',
        'warehouseNameEn': 'Main store',
        'warehouseNameAr': 'المخزن الرئيسي',
        'scope': 'FULL',
        // Reached REVIEW like st-1, but the current user opened it, so the
        // service refuses their approval and the screen explains why.
        'status': 'REVIEW',
        'frozenAt': null,
        'createdBy': 'u',
        'approvedAt': null,
        'approvedBy': null,
        'postedAt': null,
        'documentId': null,
        'journalEntryId': null,
        'lineCount': 7,
        'notes': null,
        'createdAt': '2026-11-03T09:00:00.000Z',
      },
    ];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/stock-takes/st-1' || path == '/inventory/stock-takes/st-new') {
      return Map<String, dynamic>.from(detail);
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add(path);
    bodies[path] = body;
    if (path == '/inventory/stock-takes') return {'id': 'st-new'};
    if (path.endsWith('/count')) return Map<String, dynamic>.from(detail);
    return const {};
  }
}

const _approver = [
  'inventory.stocktake.read',
  'inventory.stocktake.approve',
  'inventory.stocktake.post',
];

Finder tableText(String value) => find.byWidgetPredicate(
  (widget) => widget is Text && widget.data == value,
);

void main() {
  Future<void> pump(
    WidgetTester tester,
    _StockTakesApi api, {
    Locale locale = const Locale('en'),
    List<String> permissions = _approver,
  }) async {
    tester.view.physicalSize = const Size(1700, 1000);
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
          home: const Scaffold(body: StockTakesScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('lists sessions with warehouse, scope, lines and status', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    expect(find.text('ST-001'), findsOneWidget);
    expect(find.text('ST-002'), findsOneWidget);
    expect(find.text('ST-003'), findsOneWidget);
    expect(find.text('Main store'), findsWidgets);
    expect(find.text('Full'), findsWidgets);
    expect(find.text('Partial'), findsOneWidget);
    expect(find.text('12'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('statuses are words, and reached statuses look different', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    expect(find.text('Counting'), findsNWidgets(2));
    expect(find.text('Approved'), findsOneWidget);
    expect(find.text('COUNTING'), findsNothing);
  });

  testWidgets('an approver sees Approve on sessions awaiting review only', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    // Two sessions await review; one was opened by this user, so it shows a
    // disabled button instead of an Approve action.
    expect(find.byTooltip('Approve'), findsOneWidget);
    expect(find.byTooltip('Post'), findsOneWidget);
  });

  testWidgets('the person who opened a count cannot approve it', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    // The reason is on the control itself, so it is legible before the click.
    expect(
      find.byTooltip('You opened this count, so you cannot approve it'),
      findsOneWidget,
    );
    final tooltip = find.byTooltip(
      'You opened this count, so you cannot approve it',
    );
    final button = tester.widget<IconButton>(
      find.descendant(of: tooltip, matching: find.byType(IconButton)),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('approving confirms first, and says that posting moves stock', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Approve'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Approving does not move stock yet'),
      findsOneWidget,
    );
    expect(api.posts, isEmpty);
  });

  testWidgets('confirming approve posts to the session, not to a list route', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Approve'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/inventory/stock-takes/st-1/approve'));
  });

  testWidgets('posting is confirmed as irreversible before it is sent', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Post'));
    await tester.pumpAndSettle();
    expect(find.textContaining('This cannot be undone'), findsOneWidget);
    expect(api.posts, isEmpty);
  });

  testWidgets('a clerk who may count but not approve sees no approve', (
    tester,
  ) async {
    await pump(
      tester,
      _StockTakesApi(),
      permissions: const ['inventory.stocktake.read', 'inventory.stocktake.count'],
    );
    expect(find.text('ST-001'), findsOneWidget);
    expect(find.byTooltip('Approve'), findsNothing);
    expect(find.byTooltip('Post'), findsNothing);
    expect(
      find.byTooltip('You opened this count, so you cannot approve it'),
      findsNothing,
    );
  });

  testWidgets('search narrows by code and by warehouse', (tester) async {
    await pump(tester, _StockTakesApi());
    await tester.enterText(find.byType(TextField).first, 'ST-002');
    await tester.pumpAndSettle();
    expect(tableText('ST-002'), findsOneWidget);
    expect(tableText('ST-001'), findsNothing);
  });

  testWidgets('a failed list shows the error view with a retry', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi(failList: true));
    expect(find.textContaining('STOCKTAKE_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('creates a full stock take and opens its frozen count lines', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(
      tester,
      api,
      permissions: const ['inventory.stocktake.read', 'inventory.stocktake.create', 'inventory.stocktake.count'],
    );
    await tester.tap(find.byKey(const ValueKey('stock-take-new')));
    await tester.pumpAndSettle();
    expect(find.text('Open count'), findsOneWidget);
    await tester.tap(find.text('Open count'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/inventory/stock-takes'));
    expect(find.text('ST-001 — Stock take details'), findsOneWidget);
    expect(find.text('ITEM-1 — Coffee'), findsOneWidget);
  });

  testWidgets('saves counted quantities to the session count endpoint', (
    tester,
  ) async {
    final api = _StockTakesApi();
    await pump(
      tester,
      api,
      permissions: const ['inventory.stocktake.read', 'inventory.stocktake.count'],
    );
    await tester.tap(find.text('ST-001'));
    await tester.pumpAndSettle();
    expect(find.text('ITEM-1 — Coffee'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).last, '8');
    await tester.tap(find.text('Save count'));
    await tester.pumpAndSettle();
    expect(api.posts, contains('/inventory/stock-takes/st-1/count'));
    expect(api.bodies['/inventory/stock-takes/st-1/count'], {
      'lines': [
        {'lineId': 'line-1', 'countedQuantity': 8.0},
      ],
      'finish': false,
    });
  });

  testWidgets('does not offer approval while a stock take is still being counted', (
    tester,
  ) async {
    await pump(
      tester,
      _StockTakesApi(),
      permissions: const [
        'inventory.stocktake.read',
        'inventory.stocktake.approve',
      ],
    );
    expect(find.byTooltip('Approve'), findsNothing);
    expect(find.text('Counting'), findsNWidgets(2));
  });

  testWidgets('Arabic reads the Arabic warehouse name and mirrors', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi(), locale: const Locale('ar'));
    expect(find.text('الجرد'), findsOneWidget);
    expect(find.text('جارٍ العد'), findsNWidgets(2));
    expect(
      Directionality.of(tester.element(find.text('جارٍ العد').first)),
      TextDirection.rtl,
    );
  });
}
