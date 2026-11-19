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

/// Serves the people list and one person's grants, in the shape
/// `WarehouseAccessService.forUser` returns.
class _AccessApi extends ApiClient {
  _AccessApi({this.restricted = true})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool restricted;
  final puts = <(String, Object?)>[];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/admin/users') {
      return [
        {
          'id': 'person-1',
          'username': 'sara',
          'fullNameEn': 'Sara Ali',
          'fullNameAr': 'سارة علي',
          'isActive': true,
        },
      ];
    }
    return const [];
  }

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    return {
      'user': {
        'id': 'person-1',
        'username': 'sara',
        'fullNameEn': 'Sara Ali',
        'fullNameAr': 'سارة علي',
      },
      'restricted': restricted,
      'grants': restricted
          ? [
              {
                'warehouseId': 'wh-1',
                'warehouseCode': 'MAIN',
                'warehouseNameEn': 'Main store',
                'warehouseNameAr': 'المخزن الرئيسي',
                'canView': true,
                'canReceive': true,
                'canIssue': false,
                'canTransfer': false,
                'canCount': true,
                'canApprove': false,
                'canSeeCost': false,
              },
            ]
          : const [],
      'warehouses': [
        {
          'id': 'wh-1',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
          'branchId': 'br-1',
        },
        {
          'id': 'wh-2',
          'code': 'BR2',
          'nameEn': 'Second store',
          'nameAr': 'المخزن الثاني',
          'branchId': 'br-1',
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> put(String path, {Object? body}) async {
    puts.add((path, body));
    return const {};
  }
}

const _admin = [
  'inventory.warehouse.access.read',
  'inventory.warehouse.access.manage',
  'admin.users.manage',
];

void main() {
  Future<void> pump(
    WidgetTester tester,
    _AccessApi api, {
    Locale locale = const Locale('en'),
    List<String> permissions = _admin,
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
          home: const Scaffold(body: WarehouseAccessScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> choosePerson(WidgetTester tester) async {
    await tester.tap(find.text('Sara Ali'));
    await tester.pumpAndSettle();
  }

  testWidgets('asks for a person before showing any rights', (tester) async {
    await pump(tester, _AccessApi());
    expect(find.text('Sara Ali'), findsOneWidget);
    expect(find.textContaining('Choose a person'), findsOneWidget);
  });

  testWidgets('a restricted person is described as restricted', (
    tester,
  ) async {
    await pump(tester, _AccessApi());
    await choosePerson(tester);
    expect(find.textContaining('Restricted to the warehouses'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a person with no grants is described as unrestricted', (
    tester,
  ) async {
    await pump(tester, _AccessApi(restricted: false));
    await choosePerson(tester);
    expect(find.textContaining('Unrestricted'), findsOneWidget);
  });

  testWidgets('each warehouse shows whether it is granted at all', (
    tester,
  ) async {
    await pump(tester, _AccessApi());
    await choosePerson(tester);
    expect(find.text('MAIN — Main store'), findsOneWidget);
    expect(find.text('BR2 — Second store'), findsOneWidget);
    // One switch per warehouse, and only MAIN is on.
    final switches = tester.widgetList<Switch>(find.byType(Switch)).toList();
    expect(switches.length, 2);
    expect(switches.where((s) => s.value == true).length, 1);
  });

  testWidgets('an ungranted warehouse says it is invisible, not blank', (
    tester,
  ) async {
    await pump(tester, _AccessApi());
    await choosePerson(tester);
    expect(
      find.textContaining('this warehouse is not visible to them'),
      findsOneWidget,
    );
  });

  testWidgets('nothing is sent until Save is pressed', (tester) async {
    final api = _AccessApi();
    await pump(tester, api);
    await choosePerson(tester);
    await tester.tap(find.text('Receive'));
    await tester.pumpAndSettle();
    expect(api.puts, isEmpty);
    expect(find.text('Unsaved changes'), findsOneWidget);
  });

  testWidgets('a second warehouse is added to the whole set, not on its own', (
    tester,
  ) async {
    final api = _AccessApi();
    await pump(tester, api);
    await choosePerson(tester);

    // Turn the second warehouse on, then save.
    await tester.tap(find.byType(Switch).last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save').last);
    await tester.pumpAndSettle();

    expect(api.puts, isNotEmpty);
    final body = api.puts.first.$2 as Map<String, dynamic>;
    final grants = body['grants'] as List;
    // Both warehouses travel together: the endpoint replaces the grant set, so
    // sending only the edited one would silently revoke the other.
    expect(grants.length, 2);
    expect(
      grants.map((g) => (g as Map)['warehouseId']).toSet(),
      {'wh-1', 'wh-2'},
    );
  });

  testWidgets('saving states that the grant set is replaced, not merged', (
    tester,
  ) async {
    await pump(tester, _AccessApi());
    await choosePerson(tester);
    await tester.tap(find.text('Issue'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('replaced entirely by what is shown'),
      findsOneWidget,
    );
  });

  testWidgets('switching every warehouse off warns that it means unrestricted', (
    tester,
  ) async {
    await pump(tester, _AccessApi());
    await choosePerson(tester);
    await tester.tap(find.byType(Switch).first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    // An empty grant set means "every warehouse", not "none", and the
    // confirmation has to say so.
    expect(find.textContaining('see every warehouse'), findsWidgets);
  });

  testWidgets('a supervisor without the user grant is told why, not shown blank', (
    tester,
  ) async {
    await pump(
      tester,
      _AccessApi(),
      permissions: const ['inventory.warehouse.access.read'],
    );
    expect(find.textContaining('admin.users.manage'), findsOneWidget);
    expect(find.text('Sara Ali'), findsNothing);
  });

  testWidgets('without the read grant the screen says what is missing', (
    tester,
  ) async {
    await pump(tester, _AccessApi(), permissions: const []);
    expect(
      find.textContaining('warehouse-access read grant'),
      findsOneWidget,
    );
  });

  testWidgets('a read-only grant offers no switch and no save', (tester) async {
    await pump(
      tester,
      _AccessApi(),
      permissions: const [
        'inventory.warehouse.access.read',
        'admin.users.manage',
      ],
    );
    await choosePerson(tester);
    expect(find.text('MAIN — Main store'), findsOneWidget);
    final switches = tester.widgetList<Switch>(find.byType(Switch)).toList();
    expect(switches.every((s) => s.onChanged == null), isTrue);
    expect(find.widgetWithText(FilledButton, 'Save'), findsNothing);
  });

  testWidgets('Arabic reads the Arabic names and mirrors', (tester) async {
    await pump(tester, _AccessApi(), locale: const Locale('ar'));
    expect(find.text('صلاحيات المستودعات'), findsOneWidget);
    await tester.tap(find.text('سارة علي'));
    await tester.pumpAndSettle();
    expect(find.text('MAIN — المخزن الرئيسي'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('MAIN — المخزن الرئيسي'))),
      TextDirection.rtl,
    );
  });
}
