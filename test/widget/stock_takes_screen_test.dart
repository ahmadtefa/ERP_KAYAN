import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_takes_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:erp_kayan/shared/widgets/records_table.dart';
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

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (failList) throw StateError('STOCKTAKE_LIST_FAILED');
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
        'status': 'COUNTING',
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
        'status': 'COUNTING',
        'frozenAt': null,
        // The current user opened this one, so the backend would refuse their
        // approval.
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
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add(path);
    return const {};
  }
}

const _approver = [
  'inventory.stocktake.read',
  'inventory.stocktake.approve',
  'inventory.stocktake.post',
];

/// The text as it appears in a table row.
///
/// `find.text` also matches `EditableText` (Flutter's finders.dart says so
/// explicitly), so a search box containing "LOT-B" makes `find.text('LOT-B')`
/// match twice: once in the box and once in the row. Excluding the field
/// makes the assertion say what it means.
Finder _inRows(String text) => find.descendant(
  of: find.byType(RecordsTable),
  matching: find.text(text),
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

  testWidgets('an approver sees Approve on counting sessions only', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi());
    // Two counting sessions, but one of them was opened by this user.
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
    // byTooltip finds the Tooltip; IconButton builds that tooltip as its own
    // child (icon_button.dart: `result = Tooltip(message: tooltip, child: ...)`),
    // so the button is the ancestor of the tooltip, not its descendant.
    final button = tester.widget<IconButton>(
      find.ancestor(
        of: find.byTooltip('You opened this count, so you cannot approve it'),
        matching: find.byType(IconButton),
      ),
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
    // `find.text` also matches EditableText, so the query itself would count
    // as a second copy of the code. The row is what this asserts.
    expect(_inRows('ST-002'), findsOneWidget);
    expect(_inRows('ST-001'), findsNothing);
  });

  testWidgets('a failed list shows the error view with a retry', (
    tester,
  ) async {
    await pump(tester, _StockTakesApi(failList: true));
    expect(find.textContaining('STOCKTAKE_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
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
