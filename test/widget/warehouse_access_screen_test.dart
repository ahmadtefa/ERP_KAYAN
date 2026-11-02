import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/warehouse_access_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Warehouse rights are per person and per warehouse, and the screen is the
/// only way to write them. The API test proves the guard refuses a person with
/// no grant; this proves the screen writes the grant the tick means - and that
/// a person who may not manage them is not offered the save at all.
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

  final List<String> puts = [];
  final List<Map<String, dynamic>> bodies = [];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/admin/users') {
      return const [
        {
          'id': 'u1',
          'username': 'sara',
          'fullNameEn': 'Sara',
          'fullNameAr': 'سارة',
        },
        {
          'id': 'u2',
          'username': 'omar',
          'fullNameEn': 'Omar',
          'fullNameAr': 'عمر',
        },
      ];
    }
    return const [];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path.startsWith('/inventory/warehouse-access/')) {
      return const {
        'user': {
          'id': 'u1',
          'username': 'sara',
          'fullNameEn': 'Sara',
          'fullNameAr': 'سارة',
        },
        // Nothing is restricted yet: every warehouse of their branches.
        'restricted': false,
        'grants': <Map<String, dynamic>>[],
        'warehouses': [
          {
            'id': 'wh-1',
            'code': 'MAIN',
            'nameEn': 'Main store',
            'nameAr': 'المخزن الرئيسي',
          },
          {
            'id': 'wh-2',
            'code': 'BR2',
            'nameEn': 'Second store',
            'nameAr': 'المخزن الثاني',
          },
        ],
      };
    }
    return const {};
  }

  @override
  Future<Map<String, dynamic>> put(
    String path, {
    Object? body,
  }) async {
    puts.add(path);
    if (body is Map<String, dynamic>) bodies.add(body);
    return const {};
  }
}

const _manager = AppUser(
  id: 'admin',
  username: 'admin',
  fullName: 'Administrator',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: [
    'inventory.warehouse.access.read',
    'inventory.warehouse.access.manage',
    'admin.users.manage',
  ],
);

Future<void> _pump(
  WidgetTester tester,
  _FakeApiClient api, {
  AppUser user = _manager,
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
        home: const Scaffold(body: WarehouseAccessScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the screen lists the warehouses a person may be limited to', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    expect(find.text('MAIN — Main store'), findsOneWidget);
    expect(find.text('BR2 — Second store'), findsOneWidget);
    // Nothing ticked yet, and the screen says what that means rather than
    // leaving the reader to guess.
    expect(
      find.textContaining('they work in every warehouse of their branches'),
      findsOneWidget,
    );
  });

  testWidgets('ticking receive and saving writes exactly that grant', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    await tester.tap(find.byKey(const ValueKey('grant-wh-2-canReceive')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('warehouse-access-save')));
    await tester.pumpAndSettle();

    expect(api.puts, ['/inventory/warehouse-access/u1']);
    expect(api.bodies.single['grants'], [
      {'warehouseId': 'wh-2', 'canReceive': true},
    ]);
  });

  testWidgets('a reader without the manage permission cannot change a grant', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(
      tester,
      api,
      user: const AppUser(
        id: 'auditor',
        username: 'auditor',
        fullName: 'Auditor',
        companyId: 'company-1',
        branchId: 'branch-1',
        permissions: ['inventory.warehouse.access.read'],
      ),
    );

    expect(find.byKey(const ValueKey('warehouse-access-save')), findsNothing);
    final box = tester.widget<Checkbox>(
      find.byKey(const ValueKey('grant-wh-1-canView')),
    );
    expect(box.onChanged, isNull);
    expect(api.puts, isEmpty);
  });
}
