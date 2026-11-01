import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_documents_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// The stock documents list is where a posted transfer is read and, when it
/// was a mistake, reversed.
///
/// The API test proves the server writes a counter-movement and refuses a
/// second reversal. This test proves the screen is a way to ask for it: the
/// card names both stores and both people, the button exists on a posted
/// document only, it asks before it acts, and but for the permission it stays
/// inert instead of letting the server refuse the click.
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

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path != '/inventory/stock-documents') return const [];
    reads.add(path);
    return const [
      {
        'id': 'doc-1',
        'documentNumber': 'TRF-0001',
        'kind': 'transfer',
        'status': 'posted',
        'documentDate': '2026-10-28',
        'lineCount': 1,
        'fromWarehouse': {
          'id': 'wh-1',
          'code': 'MAIN-1',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
        'toWarehouse': {
          'id': 'wh-2',
          'code': 'BR2-1',
          'nameEn': 'Second store',
          'nameAr': 'مخزن الفرع الثاني',
        },
        'createdByName': 'Sara',
        'postedByName': 'Omar',
      },
      {
        'id': 'doc-2',
        'documentNumber': 'ADJ-0001',
        'kind': 'adjustment',
        'status': 'draft',
        'documentDate': '2026-10-29',
        'lineCount': 2,
        'createdByName': 'Sara',
      },
    ];
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posted.add(path);
    return const {};
  }
}

const _adjuster = AppUser(
  id: 'u2',
  username: 'storekeeper',
  fullName: 'Store keeper',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: ['inventory.stock.adjust', 'inventory.warehouses.read'],
);

Future<void> _pump(
  WidgetTester tester,
  _FakeApiClient api, {
  AppUser user = _adjuster,
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
        home: const Scaffold(body: StockDocumentsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a posted transfer names both stores and both people', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    expect(api.reads, isNotEmpty);
    expect(find.text('TRF-0001 — Stock transfer'), findsOneWidget);
    // The goods left one shelf and reached another: a transfer inside one
    // branch is not a branch-to-branch move and must not read like one.
    expect(
      find.text('From MAIN-1 — Main store → BR2-1 — Second store'),
      findsOneWidget,
    );
    expect(find.text('Created by: Sara • Posted by: Omar'), findsOneWidget);

    // A draft adjustment names nobody yet and has no route to show.
    expect(find.text('ADJ-0001 — Stock adjustment'), findsOneWidget);
    expect(find.textContaining('draft'), findsOneWidget);
  });

  testWidgets('reversing asks first, then posts a counter-movement', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    final reverse = find.byKey(const ValueKey('stock-document-reverse-doc-1'));
    expect(reverse, findsOneWidget);
    await tester.ensureVisible(reverse);
    await tester.pumpAndSettle();

    // The confirmation says what will happen and what will not: the original
    // stays, and it cannot be reversed twice.
    await tester.tap(reverse);
    await tester.pumpAndSettle();
    expect(find.text('Reverse the document'), findsOneWidget);
    expect(
      find.textContaining('The original stays on file unchanged'),
      findsOneWidget,
    );

    // Backing out of the question posts nothing.
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();
    expect(api.posted, isEmpty);

    await tester.tap(reverse);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Reverse'));
    await tester.pumpAndSettle();

    expect(api.posted, ['/inventory/stock-documents/doc-1/reverse']);
  });

  testWidgets('only a posted document offers Reverse; a draft offers Post', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    expect(
      find.byKey(const ValueKey('stock-document-reverse-doc-2')),
      findsNothing,
    );
    expect(find.widgetWithText(TextButton, 'Post'), findsOneWidget);
  });

  testWidgets('without the permission the button is shown but inert', (
    tester,
  ) async {
    final api = _FakeApiClient();
    // A store keeper who may read the log but not move stock.
    await _pump(tester, api, user: testUser);

    final reverse = tester.widget<TextButton>(
      find.byKey(const ValueKey('stock-document-reverse-doc-1')),
    );
    expect(reverse.onPressed, isNull);
    final post = tester.widget<TextButton>(
      find.widgetWithText(TextButton, 'Post'),
    );
    expect(post.onPressed, isNull);
  });
}
