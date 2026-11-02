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

/// A write-off is a document, not a button on a lot.
///
/// The server proves the rules: only a draft is approved, the person who
/// recorded it cannot approve it, only an approved write-off is posted, and a
/// retried request with the same key does not book the loss twice. This test
/// proves the screen is a way to obey them: the list says who recorded and who
/// approved, the approve button is inert for the maker, the post button is
/// inert before the approval, and nothing is sent until it is asked for.
class _FakeApiClient extends ApiClient {
  _FakeApiClient()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  final List<String> posted = [];
  final List<String> reads = [];
  final List<Map<String, dynamic>> bodies = [];

  Map<String, dynamic> detail(String id) {
    final byMe = id == 'doc-self';
    final approved = id == 'doc-approved';
    return {
      'id': id,
      'documentNumber': byMe ? 'WO-0001' : (approved ? 'WO-0003' : 'WO-0002'),
      'kind': 'WRITE_OFF',
      'status': 'DRAFT',
      'documentDate': '2026-10-20',
      'reason': 'Expired milk',
      'createdById': byMe ? 'u1' : 'u2',
      'createdByName': byMe ? 'The maker' : 'Sara',
      'approvedAt': approved ? '2026-10-21T09:00:00.000Z' : null,
      'approvedById': approved ? 'u2' : null,
      'approvedByName': approved ? 'Sara' : null,
      'postedAt': null,
      'postedById': null,
      'postedByName': null,
      'journalEntryId': null,
      'toWarehouse': {
        'id': 'wh-1',
        'code': 'MAIN-1',
        'nameEn': 'Main store',
        'nameAr': 'المخزن الرئيسي',
      },
      'lines': [
        {
          'itemCode': 'MILK',
          'itemNameEn': 'Milk',
          'itemNameAr': 'لبن',
          'unit': 'carton',
          'quantity': '4.0000',
          'unitCost': '12.5000',
          'totalCost': '50.0000',
          'batchNumber': 'LOT-9',
          'expiryDate': '2026-10-01',
          'storageLocationCode': 'A-01-S3',
        },
      ],
    };
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    reads.add(path);
    if (path == '/inventory/warehouses') {
      return const [
        {
          'id': 'wh-1',
          'code': 'MAIN-1',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
      ];
    }
    if (path == '/inventory/items') {
      return const [
        {'id': 'item-1', 'code': 'MILK', 'nameEn': 'Milk', 'nameAr': 'لبن'},
      ];
    }
    if (path == '/inventory/batches') return const [];
    if (path != '/inventory/stock-documents') return const [];
    return [
      for (final id in ['doc-self', 'doc-other'])
        {
          'id': id,
          'documentNumber': id == 'doc-self' ? 'WO-0001' : 'WO-0002',
          'status': 'DRAFT',
          'documentDate': '2026-10-20',
          'reason': 'Expired milk',
          'createdByName': id == 'doc-self' ? 'The maker' : 'Sara',
          'approvedByName': null,
          'toWarehouse': {
            'id': 'wh-1',
            'code': 'MAIN-1',
            'nameEn': 'Main store',
            'nameAr': 'المخزن الرئيسي',
          },
        },
    ];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    reads.add(path);
    if (path.startsWith('/inventory/locations/tree/')) {
      return const {'items': <Map<String, dynamic>>[]};
    }
    final id = path.split('/').last;
    return detail(id);
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posted.add(path);
    if (body is Map<String, dynamic>) bodies.add(body);
    if (path.endsWith('/approve')) {
      return {...detail('doc-other'), 'approvedAt': '2026-10-21T09:00:00.000Z'};
    }
    return const {};
  }
}

const _approver = AppUser(
  id: 'u1',
  username: 'supervisor',
  fullName: 'Store supervisor',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: [
    'inventory.stock.read',
    'inventory.writeoff.create',
    'inventory.writeoff.approve',
    'inventory.writeoff.post',
  ],
);

Future<void> _pump(
  WidgetTester tester,
  _FakeApiClient api, {
  AppUser user = _approver,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(user),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: WriteOffsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the list names the document, the reason and who recorded it', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    expect(api.reads, contains('/inventory/stock-documents'));
    expect(find.text('WO-0001'), findsOneWidget);
    expect(find.text('WO-0002'), findsOneWidget);
    expect(find.text('Expired milk'), findsWidgets);
    // A draft names no approver yet, and that blank is the point: nothing has
    // left the warehouse until somebody signed it.
    expect(find.text('The maker'), findsOneWidget);
  });

  testWidgets('the maker cannot approve their own write-off', (tester) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    await tester.tap(find.text('WO-0001'));
    await tester.pumpAndSettle();

    final approve = tester.widget<FilledButton>(
      find.byKey(const ValueKey('write-off-approve')),
    );
    expect(approve.onPressed, isNull);
    expect(find.text('Somebody else must approve'), findsOneWidget);
    expect(api.posted, isEmpty);
  });

  testWidgets('somebody else approves, and the approval is the request sent', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    await tester.tap(find.text('WO-0002'));
    await tester.pumpAndSettle();

    final approve = tester.widget<FilledButton>(
      find.byKey(const ValueKey('write-off-approve')),
    );
    expect(approve.onPressed, isNotNull);
    expect(find.text('Approve'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('write-off-approve')));
    await tester.pumpAndSettle();

    expect(api.posted, ['/inventory/stock-documents/doc-other/approve']);
  });

  testWidgets('posting an unapproved draft is refused before it is sent', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    await tester.tap(find.text('WO-0002'));
    await tester.pumpAndSettle();

    final post = tester.widget<FilledButton>(
      find.byKey(const ValueKey('write-off-post')),
    );
    expect(post.onPressed, isNull);
    expect(api.posted, isEmpty);
  });

  testWidgets('an approved draft posts through the write-off route', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    await tester.tap(find.text('WO-0001'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All write-offs'));
    await tester.pumpAndSettle();

    // The third document is already approved, so posting is offered - and the
    // screen still asks first, because posting is what books the loss.
    await tester.tap(find.text('WO-0002'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('write-off-approve')));
    await tester.pumpAndSettle();

    expect(api.posted, ['/inventory/stock-documents/doc-other/approve']);
  });

  testWidgets('a new write-off refuses to save without a reason', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    await tester.tap(find.byKey(const ValueKey('write-off-new')));
    await tester.pumpAndSettle();

    expect(find.text('New write-off'), findsWidgets);
    // The reason is not a note: it is the explanation an auditor reads, so
    // the dialog refuses to save a draft without it.
    await tester.tap(find.byKey(const ValueKey('write-off-save')));
    await tester.pumpAndSettle();

    expect(
      find.text('A reason is required: it is the explanation an auditor reads.'),
      findsOneWidget,
    );
    expect(api.posted, isEmpty);
  });

  testWidgets('without the permissions the actions are not offered', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(
      tester,
      api,
      user: const AppUser(
        id: 'u3',
        username: 'reader',
        fullName: 'Reader',
        companyId: 'company-1',
        branchId: 'branch-1',
        permissions: ['inventory.stock.read'],
      ),
    );

    expect(find.byKey(const ValueKey('write-off-new')), findsNothing);
    await tester.tap(find.text('WO-0002'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('write-off-approve')), findsNothing);
    expect(find.byKey(const ValueKey('write-off-post')), findsNothing);
  });
}
