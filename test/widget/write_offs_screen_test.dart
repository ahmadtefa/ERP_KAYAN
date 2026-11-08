import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/write_offs_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Rows shaped like `StockDocumentsService.toSummary` plus the line count and
/// total quantity that `findAll` adds. Note the lowercase kind and status:
/// the service lowercases them before sending.
class _WriteOffsApi extends ApiClient {
  _WriteOffsApi({this.failList = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool failList;
  final posts = <String>[];
  final queries = <Map<String, dynamic>?>[];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    queries.add(query);
    if (failList) throw StateError('WRITEOFF_LIST_FAILED');
    return [
      {
        'id': 'wo-1',
        'documentNumber': 'WO-001',
        'kind': 'write_off',
        'documentDate': '2026-11-05',
        'status': 'draft',
        'reason': 'Broken in transit',
        'notes': null,
        'voucherKind': null,
        'editVersion': 0,
        'counterpartyName': null,
        'reviewedAt': null,
        'reviewedBy': null,
        'fromWarehouseId': 'wh-1',
        'toWarehouseId': null,
        'fromWarehouse': {
          'id': 'wh-1',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
        'toWarehouse': null,
        'createdById': 'someone-else',
        'createdByName': 'sara',
        'postedById': null,
        'postedByName': null,
        'branch': {'code': 'HQ', 'nameEn': 'Head office', 'nameAr': 'المركز'},
        'costCenterId': null,
        'costCenter': null,
        'journalEntryId': null,
        'postedAt': null,
        'approvedAt': null,
        'approvedById': null,
        'approvedByName': null,
        'createdAt': '2026-11-05T09:00:00.000Z',
        'lineCount': 2,
        'totalQuantity': '15.0000',
      },
      {
        'id': 'wo-2',
        'documentNumber': 'WO-002',
        'kind': 'write_off',
        'documentDate': '2026-11-04',
        'status': 'draft',
        'reason': 'Expired',
        'notes': null,
        'voucherKind': null,
        'editVersion': 0,
        'counterpartyName': null,
        'reviewedAt': null,
        'reviewedBy': null,
        'fromWarehouseId': 'wh-1',
        'toWarehouseId': null,
        'fromWarehouse': {
          'id': 'wh-1',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
        'toWarehouse': null,
        'createdById': 'u',
        'createdByName': 'me',
        'postedById': null,
        'postedByName': null,
        'branch': {'code': 'HQ', 'nameEn': 'Head office', 'nameAr': 'المركز'},
        'costCenterId': null,
        'costCenter': null,
        'journalEntryId': null,
        'postedAt': null,
        // Signed by somebody else already, so only posting remains.
        'approvedAt': '2026-11-04T12:00:00.000Z',
        'approvedById': 'someone-else',
        'approvedByName': 'sara',
        'createdAt': '2026-11-04T09:00:00.000Z',
        'lineCount': 1,
        'totalQuantity': '3.0000',
      },
      {
        'id': 'wo-3',
        'documentNumber': 'WO-003',
        'kind': 'write_off',
        'documentDate': '2026-11-03',
        'status': 'draft',
        'reason': 'Spoiled',
        'notes': null,
        'voucherKind': null,
        'editVersion': 0,
        'counterpartyName': null,
        'reviewedAt': null,
        'reviewedBy': null,
        'fromWarehouseId': 'wh-1',
        // Raised by the current user and still unsigned: the backend would
        // refuse their approval, so the control must be disabled with a
        // reason rather than offered.
        'createdById': 'u',
        'createdByName': 'me',
        'postedById': null,
        'postedByName': null,
        'branch': {'code': 'HQ', 'nameEn': 'Head office', 'nameAr': 'المركز'},
        'costCenterId': null,
        'costCenter': null,
        'journalEntryId': null,
        'postedAt': null,
        'approvedAt': null,
        'approvedById': null,
        'approvedByName': null,
        'createdAt': '2026-11-03T09:00:00.000Z',
        'lineCount': 2,
        'totalQuantity': '8.0000',
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

const _signer = [
  'inventory.stock.read',
  'inventory.writeoff.approve',
  'inventory.writeoff.post',
];

Finder tableText(String value) => find.byWidgetPredicate(
  (widget) => widget is Text && widget.data == value,
);

void main() {
  Future<void> pump(
    WidgetTester tester,
    _WriteOffsApi api, {
    Locale locale = const Locale('en'),
    List<String> permissions = _signer,
  }) async {
    tester.view.physicalSize = const Size(1800, 1000);
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
          home: const Scaffold(body: WriteOffsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('asks the server for write-offs only, not every stock document', (
    tester,
  ) async {
    final api = _WriteOffsApi();
    await pump(tester, api);
    expect(api.queries, isNotEmpty);
    expect(api.queries.first?['kind'], 'WRITE_OFF');
  });

  testWidgets('lists the number, date, warehouse, quantity and reason', (
    tester,
  ) async {
    await pump(tester, _WriteOffsApi());
    expect(find.text('WO-001'), findsOneWidget);
    expect(find.text('WO-002'), findsOneWidget);
    expect(find.text('2026-11-05'), findsOneWidget);
    expect(find.text('Broken in transit'), findsOneWidget);
    expect(find.text('Main store'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an approved draft is named waiting for posting, not draft', (
    tester,
  ) async {
    await pump(tester, _WriteOffsApi());
    // WO-001 is untouched; WO-002 carries an approval stamp.
    expect(find.text('Draft'), findsNWidgets(2));
    expect(find.text('Awaiting posting'), findsOneWidget);
  });

  testWidgets('an approver is offered Approve only on unsigned drafts', (
    tester,
  ) async {
    await pump(tester, _WriteOffsApi());
    // WO-001 is unsigned and was raised by somebody else, so it can be
    // approved. WO-002 already carries a signature, and WO-003 is the caller's
    // own draft so its control is disabled and carries a different tooltip.
    expect(find.byTooltip('Approve'), findsOneWidget);
  });

  testWidgets('the person who raised a write-off cannot approve it', (
    tester,
  ) async {
    await pump(tester, _WriteOffsApi());
    // WO-003 is an unsigned draft raised by this user. The engine would refuse
    // the approval, so the control is present but disabled, and says why.
    final tooltip = find.byTooltip(
      'You raised this document, so you cannot approve it',
    );
    expect(tooltip, findsOneWidget);
    final button = tester.widget<IconButton>(
      find.descendant(of: tooltip, matching: find.byType(IconButton)),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('a signed draft offers Post, an unsigned one does not', (
    tester,
  ) async {
    await pump(tester, _WriteOffsApi());
    expect(find.byTooltip('Post'), findsOneWidget);
  });

  testWidgets('approving a write-off posts to the write-off route', (
    tester,
  ) async {
    final api = _WriteOffsApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Approve'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Stock does not move until it is posted'),
      findsOneWidget,
    );
    expect(api.posts, isEmpty);

    await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
    await tester.pumpAndSettle();
    expect(
      api.posts,
      contains('/inventory/stock-documents/wo-1/write-off/approve'),
    );
  });

  testWidgets('posting warns that stock and the journal both move', (
    tester,
  ) async {
    final api = _WriteOffsApi();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Post'));
    await tester.pumpAndSettle();
    expect(find.textContaining('cannot be undone'), findsOneWidget);
    expect(api.posts, isEmpty);
  });

  testWidgets('without the approve and post grants both actions disappear', (
    tester,
  ) async {
    await pump(
      tester,
      _WriteOffsApi(),
      permissions: const ['inventory.stock.read'],
    );
    expect(find.text('WO-001'), findsOneWidget);
    expect(find.byTooltip('Approve'), findsNothing);
    expect(find.byTooltip('Post'), findsNothing);
  });

  testWidgets('search narrows by number, reason and warehouse', (tester) async {
    await pump(tester, _WriteOffsApi());
    await tester.enterText(find.byType(TextField).first, 'Expired');
    await tester.pumpAndSettle();
    expect(find.text('WO-002'), findsOneWidget);
    expect(find.text('WO-001'), findsNothing);

    await tester.enterText(find.byType(TextField).first, 'WO-001');
    await tester.pumpAndSettle();
    expect(tableText('WO-001'), findsOneWidget);
    expect(tableText('WO-002'), findsNothing);
  });

  testWidgets('a failed list shows the error view with a retry', (tester) async {
    await pump(tester, _WriteOffsApi(failList: true));
    expect(find.textContaining('WRITEOFF_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic names the screen and mirrors', (tester) async {
    await pump(tester, _WriteOffsApi(), locale: const Locale('ar'));
    expect(find.text('الإعدام'), findsOneWidget);
    expect(find.text('المخزن الرئيسي'), findsWidgets);
    expect(
      Directionality.of(tester.element(find.text('المخزن الرئيسي').first)),
      TextDirection.rtl,
    );
  });
}
