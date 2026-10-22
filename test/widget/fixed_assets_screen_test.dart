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
    },
    {
      'id': 'asset-tool',
      'code': 'FA-T-1',
      'nameEn': 'Small tool',
      'nameAr': 'عدة',
      'category': 'Tools',
      'status': 'DRAFT',
      'cost': '1200.0000',
      'accumulatedDepreciation': '0.0000',
      'bookValue': '1200.0000',
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

Future<_FakeApiClient> _pump(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1500, 950);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final api = _FakeApiClient();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(_user),
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

    await tester.tap(find.byTooltip('Activate (post acquisition)'));
    await tester.pumpAndSettle();
    // Pick the funding account from the dropdown.
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('1101.REC').last);
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
}
