import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/fixed_assets/presentation/fixed_assets_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// A scripted stand-in for the API, in the shape of the real client.
///
/// It plays the fixed-assets endpoints from in-memory state so the
/// screen's whole user path runs: list, activate, run depreciation,
/// refuse the second run of a month, dispose. The numbers it serves
/// are the lifecycle scenario's (a 120,000 machine at 1,800 a month),
/// so what renders here is what the real API returns there. The
/// server-side truth of those numbers is the integration scenario's
/// job; this file proves the user can actually drive it.
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

  final List<({String path, Object? body})> posts = [];
  final List<({String path, Object? body})> patches = [];
  final Set<String> depreciatedMonths = {};

  List<Json> assets = [
    {
      'id': 'asset-machine',
      'code': 'FA-M-1',
      'nameEn': 'Lifecycle machine',
      'nameAr': 'ماكينة',
      'category': 'Machinery',
      'status': 'ACTIVE',
      'cost': '120000.0000',
      'accumulatedDepreciation': '5400.0000',
      'bookValue': '114600.0000',
      'lastDepreciationPeriod': '2025-01',
    },
    {
      'id': 'asset-tool',
      'code': 'FA-T-1',
      'nameEn': 'Small tool',
      'nameAr': 'عدة',
      'category': 'Tools',
      'status': 'DRAFT',
      'cost': '1200.0000',
      'salvageValue': '200.0000',
      'usefulLifeMonths': 12,
      'accumulatedDepreciation': '0.0000',
      'bookValue': '1200.0000',
      'assetAccountId': 'acc-asset',
      'accumulatedAccountId': 'acc-accum',
      // The form's key for the depreciation expense account.
      'expenseAccountId': 'acc-expense',
      'purchaseDate': '2025-03-01',
      'inServiceDate': '2025-03-01',
      // A draft capitalised from a purchase line: the edit form can
      // still change its mind and unlink it.
      'purchaseInvoiceLineId': 'line-9',
      'purchaseQuantity': '2.0000',
    },
  ];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/fixed-assets') return assets;
    if (path == '/accounting/chart-of-accounts') {
      return [
        {
          'id': 'acc-cash',
          'code': '1101.REC',
          'nameEn': 'Lifecycle cash',
          'type': 'asset',
          'isPostable': true,
        },
        {
          'id': 'acc-asset',
          'code': '1201.REC',
          'nameEn': 'Plant',
          'type': 'asset',
          'isPostable': true,
        },
        {
          'id': 'acc-accum',
          'code': '1203.REC',
          'nameEn': 'Accumulated',
          'type': 'asset',
          'isPostable': true,
        },
        {
          'id': 'acc-expense',
          'code': '5105.REC',
          'nameEn': 'Depreciation expense',
          'type': 'expense',
          'isPostable': true,
        },
      ];
    }
    return [];
  }

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/fixed-assets/reports/summary') {
      return {
        'totals': {
          'cost': '121200.0000',
          'accumulatedDepreciation': '5400.0000',
          'bookValue': '115800.0000',
        },
        'items': assets,
      };
    }
    if (path == '/fixed-assets/depreciation-runs') {
      return {
        'items': [
          {
            'runNumber': 'DEP-000001',
            'period': '2025-01',
            'runDate': '2025-01-31',
            'totalAmount': '1000.0000',
            'lines': [
              {'fixedAssetId': 'asset-machine', 'amount': '1000.0000'},
            ],
          },
        ],
      };
    }
    if (path == '/fixed-assets/purchase-lines') {
      return {
        'items': [
          {
            'lineId': 'line-9',
            'invoiceId': 'inv-9',
            'invoiceNumber': 'PI-9',
            'description': 'Press unit',
            'remainingQuantity': '2.0000',
            'remainingCost': '1200.0000',
          },
        ],
      };
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add((path: path, body: body));
    if (path == '/fixed-assets/depreciation-runs') {
      final period = (body! as Map)['period'] as String;
      if (!depreciatedMonths.add(period)) {
        throw ApiFailure(
          'Nothing to depreciate for $period — FA-M-1: already depreciated for $period',
          statusCode: 400,
        );
      }
      return {'run': {'runNumber': 'DEP-000001'}};
    }
    if (path.endsWith('/activate')) {
      final id = path.split('/')[2];
      assets = [
        for (final asset in assets)
          if (asset['id'] == id) {...asset, 'status': 'ACTIVE'} else asset,
      ];
      return {'id': id, 'status': 'ACTIVE'};
    }
    if (path.endsWith('/dispose')) {
      final id = path.split('/')[2];
      assets = [
        for (final asset in assets)
          if (asset['id'] == id) {...asset, 'status': 'DISPOSED'} else asset,
      ];
      return {'id': id, 'status': 'DISPOSED'};
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    patches.add((path: path, body: body));
    return {};
  }
}

const _user = AppUser(
  id: 'user-1',
  username: 'accountant',
  fullName: 'Accountant',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: [
    'accounting.fixedassets.read',
    'accounting.fixedassets.manage',
    'accounting.fixedassets.depreciate',
  ],
);

class _Prefilled extends AssetPrefillNotifier {
  _Prefilled(this.values);

  final Json values;

  @override
  Json? build() => values;
}

Future<_FakeApiClient> _pump(
  WidgetTester tester, {
  Json? prefill,
  Size size = const Size(1500, 950),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final api = _FakeApiClient();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(_user),
        if (prefill != null)
          assetPrefillProvider.overrideWith(() => _Prefilled(prefill)),
      ],
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: FixedAssetsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return api;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the register shows cost, accumulated and book value', (
    tester,
  ) async {
    await _pump(tester);

    expect(find.text('FA-M-1'), findsOneWidget);
    expect(find.text('Lifecycle machine'), findsOneWidget);
    // The register row: 120,000 cost, 5,400 charged, 114,600 still on
    // the books (formatted the way every amount in the app is).
    expect(find.textContaining('120,000'), findsWidgets);
    expect(find.textContaining('5,400'), findsWidgets);
    expect(find.textContaining('114,600'), findsOneWidget);
    // Status drives the offered actions: a draft can be activated, an
    // active asset can be disposed, and never the other way round.
    expect(find.byTooltip('Activate (post acquisition)'), findsOneWidget);
    expect(find.byTooltip('Dispose of asset'), findsOneWidget);
    expect(find.byTooltip('Edit'), findsOneWidget);
  });

  testWidgets('running depreciation posts the month the user typed', (
    tester,
  ) async {
    final api = await _pump(tester);

    await tester.tap(find.text('Run depreciation'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Month (YYYY-MM)'),
      '2024-01',
    );
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    final runs = api.posts
        .where((p) => p.path == '/fixed-assets/depreciation-runs')
        .toList();
    expect(runs, hasLength(1));
    expect((runs.single.body! as Map)['period'], '2024-01');
  });

  testWidgets('a refused second run says why and changes nothing', (
    tester,
  ) async {
    final api = await _pump(tester);
    api.depreciatedMonths.add('2024-01');

    await tester.tap(find.text('Run depreciation'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Month (YYYY-MM)'),
      '2024-01',
    );
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(find.textContaining('already depreciated'), findsOneWidget);
    // The register still shows the figures as they were.
    expect(find.textContaining('114,600'), findsOneWidget);
  });

  testWidgets('activating a draft sends the funding account chosen', (
    tester,
  ) async {
    final api = await _pump(tester);

    // The row actions sit at the far side of a wide table; bring the
    // button on screen the way a user scrolling sideways would.
    final activateButton = find.byTooltip('Activate (post acquisition)');
    await tester.ensureVisible(activateButton);
    await tester.pumpAndSettle();
    await tester.tap(activateButton);
    await tester.pumpAndSettle();
    expect(
      find.byType(AlertDialog),
      findsOneWidget,
      reason: 'the activation form opens',
    );
    // Pick the funding account from the dropdown.
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    expect(
      find.textContaining('1101.REC — Lifecycle cash'),
      findsWidgets,
      reason: 'the account menu lists the postable accounts',
    );
    await tester.tap(find.textContaining('1101.REC — Lifecycle cash').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    // The confirmation explains the entry before it is posted.
    expect(find.textContaining('Dr asset'), findsOneWidget);
    await tester.tap(
      find.widgetWithText(FilledButton, 'Activate (post acquisition)'),
    );
    await tester.pumpAndSettle();

    final activations = api.posts.where((p) => p.path.endsWith('/activate'));
    expect(activations, hasLength(1));
    expect(
      (activations.single.body! as Map)['fundingAccountId'],
      'acc-cash',
    );
  });

  testWidgets('a deposited purchase line opens the create form prefilled', (
    tester,
  ) async {
    // The purchase-invoice side of "create asset from this line" only
    // deposits values and navigates; this is the receiving half.
    await _pump(
      tester,
      prefill: {
        'purchaseInvoiceLineId': 'line-9',
        'purchaseQuantity': '2',
        'cost': '1200',
        'purchaseDate': '2025-03-01',
        'inServiceDate': '2025-03-01',
        'nameEn': 'Press unit',
        'nameAr': 'وحدة كبس',
      },
    );

    expect(find.byType(AlertDialog), findsOneWidget,
        reason: 'the create form opens on arrival');
    final fieldTexts = tester
        .widgetList<TextField>(find.byType(TextField))
        .map((field) => field.controller?.text ?? '')
        .toList();
    expect(fieldTexts, contains('1200'),
        reason: 'the remaining line cost is prefilled');
    expect(fieldTexts, contains('Press unit'));

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    // And nothing was created by merely arriving with a prefill.
    expect(find.text('FA-M-1'), findsOneWidget);
  });

  testWidgets('search and the status filter narrow the register', (
    tester,
  ) async {
    await _pump(tester);

    // Both assets to begin with, last depreciation month visible.
    expect(find.text('FA-M-1'), findsOneWidget);
    expect(find.text('FA-T-1'), findsOneWidget);
    expect(find.text('2025-01'), findsWidgets);

    await tester.enterText(
      find.widgetWithText(TextField, 'Search code, name or location'),
      'Small',
    );
    await tester.pumpAndSettle();
    expect(find.text('FA-T-1'), findsOneWidget);
    expect(find.text('FA-M-1'), findsNothing);

    await tester.enterText(
      find.widgetWithText(TextField, 'Search code, name or location'),
      '',
    );
    await tester.pumpAndSettle();

    // Status filter: drafts only.
    await tester.tap(find.byType(DropdownButtonFormField<String?>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('DRAFT').last);
    await tester.pumpAndSettle();
    expect(find.text('FA-T-1'), findsOneWidget);
    expect(find.text('FA-M-1'), findsNothing);
  });

  testWidgets('the run history shows numbers, periods and totals', (
    tester,
  ) async {
    await _pump(tester);

    await tester.tap(find.byTooltip('Depreciation runs'));
    await tester.pumpAndSettle();

    expect(find.text('DEP-000001 · 2025-01'), findsOneWidget);
    expect(find.textContaining('1,000'), findsWidgets);
  });

  testWidgets('disposing sends the date and proceeds typed', (tester) async {
    final api = await _pump(tester);

    final disposeButton = find.byTooltip('Dispose of asset');
    await tester.ensureVisible(disposeButton);
    await tester.pumpAndSettle();
    await tester.tap(disposeButton);
    await tester.pumpAndSettle();

    // The date field is read-only and opens a picker; drive it the
    // way a user does and accept the offered day (today).
    await tester.tap(find.widgetWithText(TextField, 'Disposal date'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Proceeds'), '1000');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    // The destructive confirmation, then the post.
    await tester.tap(find.widgetWithText(FilledButton, 'Dispose of asset'));
    await tester.pumpAndSettle();

    final disposals = api.posts.where((p) => p.path.endsWith('/dispose'));
    expect(disposals, hasLength(1));
    expect(disposals.single.path, '/fixed-assets/asset-machine/dispose');
    expect((disposals.single.body! as Map)['proceeds'], '1000');
    final now = DateTime.now();
    final today =
        '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
    expect((disposals.single.body! as Map)['date'], today);
  });

  testWidgets('a draft can be unlinked from its purchase line', (
    tester,
  ) async {
    final api = await _pump(tester);

    final editButton = find.byTooltip('Edit');
    await tester.ensureVisible(editButton);
    await tester.pumpAndSettle();
    await tester.tap(editButton);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);

    // The purchase-line dropdown currently shows the linked line.
    final lineDropdown = find.ancestor(
      of: find.textContaining('PI-9'),
      matching: find.byType(DropdownButtonFormField<String>),
    );
    expect(lineDropdown, findsWidgets);
    await tester.ensureVisible(lineDropdown.first);
    await tester.pumpAndSettle();
    await tester.tap(lineDropdown.first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('— No link —').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.patches, hasLength(1));
    final body = api.patches.single.body! as Map;
    // The unlink must be explicit nulls, not missing keys — a missing
    // key would leave the old link standing on the server.
    expect(body.containsKey('purchaseInvoiceLineId'), isTrue);
    expect(body['purchaseInvoiceLineId'], isNull);
    expect(body['purchaseQuantity'], isNull);
  });

  for (final size in [const Size(390, 844), const Size(320, 700)]) {
    testWidgets('the register is readable at ${size.width}px wide', (
      tester,
    ) async {
      await _pump(tester, size: size);

      expect(tester.takeException(), isNull,
          reason: 'no overflow on a phone-width register');
      // The card stacks label over value, so the figures are on screen
      // whole — no sideways hunt for a book value.
      expect(find.text('FA-M-1'), findsOneWidget);
      expect(find.textContaining('114,600'), findsWidgets);
      expect(find.textContaining('120,000'), findsWidgets);
    });
  }
}
