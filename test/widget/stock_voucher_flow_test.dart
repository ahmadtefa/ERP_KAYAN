import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_screen.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:go_router/go_router.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_vouchers_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

class _VoucherApi extends ApiClient {
  _VoucherApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'blocked': false};
  final requests = <Map<String, dynamic>>[];
  final actions = <String>[];
  final actionVersions = <Object?>[];
  bool reviewed = false, approved = false, paged = false;
  final itemPages = <int>[];
  final listQueries = <Map<String, dynamic>>[];
  final barcodeQueries = <String>[];
  String status = 'draft';
  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/items') {
      final page = (query?['page'] as int?) ?? 1;
      itemPages.add(page);
      if (paged) {
        return page == 1
            ? [
                for (var i = 1; i <= 200; i++)
                  {'id': 'item-$i', 'code': 'IT-$i', 'nameEn': 'Item $i'},
              ]
            : [
                {'id': 'item-201', 'code': 'IT-201', 'nameEn': 'Item 201'},
              ];
      }
      return [
        {
          'id': 'item',
          'code': 'IT',
          'nameEn': 'Item',
          'unit': 'piece',
          'units': [
            {'unit': 'piece', 'factor': '1', 'isActive': true},
            {'unit': 'box', 'factor': '2', 'isActive': true},
          ],
        },
      ];
    }
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'warehouse', 'code': 'WH', 'nameEn': 'Warehouse'},
      ];
    }
    if (path == '/accounting/cost-centers') {
      return [
        {
          'id': 'center',
          'code': 'CC',
          'nameEn': 'Synthetic center',
          'isActive': true,
        },
      ];
    }
    return [];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path.startsWith('/inventory/items/by-barcode/')) {
      barcodeQueries.add(path);
      // Only the label this fixture knows resolves. Anything else answers the
      // way the server does - a 404 - so the test exercises the real failure
      // path instead of a satisfied stub.
      if (!path.endsWith('/BOX-001')) {
        throw const ApiFailure(
          'No item or unit carries that barcode',
          statusCode: 404,
        );
      }
      final item = {
        'id': 'item',
        'code': 'IT',
        'nameEn': 'Item',
        'unit': 'piece',
        'units': [
          {'unit': 'piece', 'factor': '1', 'barcode': null, 'isActive': true},
          {
            'unit': 'box',
            'factor': '2',
            'barcode': 'BOX-001',
            'isActive': true,
          },
        ],
      };
      return {
        'matched': 'unit',
        'unit': 'box',
        'factor': '2.000000',
        'item': item,
      };
    }
    if (path == '/inventory/stock-documents') {
      listQueries.add(Map<String, dynamic>.from(query ?? {}));
      return {'items': <Map<String, dynamic>>[], 'total': 0};
    }
    return {
      'id': 'document',
      'documentNumber': 'SA-1',
      'documentDate': '2026-11-04',
      'voucherKind': 'ISSUE',
      'status': status,
      'editVersion': approved
          ? 2
          : reviewed
          ? 1
          : 0,
      'counterpartyName': 'Department',
      'reason': 'Synthetic',
      'toWarehouseId': 'warehouse',
      'costCenterId': 'center',
      'reviewedAt': reviewed ? '2026-11-04T12:00:00Z' : null,
      'approvedAt': approved ? '2026-11-04T12:01:00Z' : null,
      'lines': [
        {
          'itemCode': 'IT',
          'itemNameEn': 'Item',
          'quantity': '-2',
          'unit': 'piece',
          'unitCost': '7',
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    if (path == '/inventory/stock-documents') {
      requests.add(Map<String, dynamic>.from(body! as Map));
      if (requests.length == 1) throw const NetworkFailure();
      return {'id': 'document'};
    }
    final action = path.split('/').last;
    actions.add(action);
    actionVersions.add(body is Map ? body['expectedVersion'] : null);
    if (action == 'review') reviewed = true;
    if (action == 'approve') approved = true;
    if (action == 'post') status = 'posted';
    if (action == 'reverse') status = 'reversed';
    return {'id': 'document'};
  }
}

class _BilingualVoucherApi extends _VoucherApi {
  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') {
      return [
        {
          'id': 'warehouse',
          'code': 'WH',
          'nameAr': 'مخزن تجريبي',
          'nameEn': 'Test warehouse',
        },
      ];
    }
    if (path == '/accounting/cost-centers') {
      return [
        {
          'id': 'center',
          'code': 'CC',
          'nameAr': 'مركز تجريبي',
          'nameEn': 'Test center',
          'isActive': true,
        },
      ];
    }
    if (path == '/inventory/items') {
      return [
        {
          'id': 'item',
          'code': 'IT',
          'nameAr': 'صنف تجريبي',
          'nameEn': 'Test item',
          'unit': 'piece',
        },
      ];
    }
    return super.getList(path, query: query);
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    final doc = await super.getObject(path, query: query);
    if (path != '/inventory/stock-documents/document') return doc;
    return {
      ...doc,
      'toWarehouse': {
        'id': 'warehouse',
        'nameAr': 'مخزن تجريبي',
        'nameEn': 'Test warehouse',
      },
      'costCenter': {
        'id': 'center',
        'nameAr': 'مركز تجريبي',
        'nameEn': 'Test center',
      },
      'lines': [
        {
          'itemCode': 'IT',
          'itemNameAr': 'صنف تجريبي',
          'itemNameEn': 'Test item',
          'quantity': '-2',
          'unit': 'piece',
          'unitCost': '7',
        },
      ],
    };
  }
}

class _EditVoucherApi extends _VoucherApi {
  _EditVoucherApi(this.kind);
  final String kind;
  final edits = <Map<String, dynamic>>[];
  bool committed = false;
  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path != '/inventory/stock-documents/document') {
      return super.getObject(path, query: query);
    }
    return {
      'id': 'document',
      'documentNumber': 'SA-1',
      'documentDate': '2026-11-04',
      'voucherKind': kind,
      'status': 'draft',
      'counterpartyName': 'Department',
      'reason': 'Synthetic',
      'toWarehouseId': 'warehouse',
      'costCenterId': 'center',
      'editVersion': committed ? 3 : 2,
      'reviewedAt': committed ? null : '2026-11-04T12:00:00Z',
      'approvedAt': committed ? null : '2026-11-04T12:01:00Z',
      'lines': [
        {
          'id': 'line',
          'itemId': 'item',
          'itemCode': 'IT',
          'itemNameEn': 'Item',
          'quantity': kind == 'ISSUE' ? '-4' : '4',
          'unit': 'box',
          'unitName': 'box',
          'unitFactor': '2.000000',
          'unitQuantity': kind == 'ISSUE' ? '-2' : '2',
          'unitCost': '7.5',
          'notes': 'Original line note',
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> put(String path, {Object? body}) async {
    expect(path, '/inventory/stock-documents/document/voucher-draft');
    edits.add(Map<String, dynamic>.from(body! as Map));
    if (!committed) {
      committed = true;
      throw const NetworkFailure();
    }
    return {'id': 'document', 'editVersion': 3};
  }
}

class _FailingLoadApi extends _VoucherApi {
  _FailingLoadApi(this.target);
  final String target;
  bool fail = true;
  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (fail &&
        ((target == 'list' && path == '/inventory/stock-documents') ||
            (target == 'detail' &&
                path == '/inventory/stock-documents/document'))) {
      throw StateError('INTERNAL_DIAGNOSTIC_DO_NOT_SHOW');
    }
    return super.getObject(path, query: query);
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (fail &&
        ((target == 'create' && path == '/inventory/items') ||
            (target == 'history' && path == '/admin/audit-logs'))) {
      throw StateError('INTERNAL_DIAGNOSTIC_DO_NOT_SHOW');
    }
    return super.getList(path, query: query);
  }
}

const _user = AppUser(
  id: 'user',
  username: 'tester',
  fullName: 'Tester',
  companyId: 'company',
  branchId: 'branch',
  isSuperAdmin: true,
);

void main() {
  for (final arabic in [false, true]) {
    testWidgets(
      'voucher detail and selectors use ${arabic ? 'Arabic RTL' : 'English LTR'} names',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = const Size(1400, 1200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = _BilingualVoucherApi();
        Widget screen(Widget child) => ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            currentUserProvider.overrideWithValue(_user),
            appConfigProvider.overrideWithValue(
              AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
            ),
            exportCapabilitiesProvider.overrideWith(
              (ref) async => ExportCapabilities.unknown,
            ),
          ],
          child: MaterialApp(
            locale: Locale(arabic ? 'ar' : 'en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: child,
          ),
        );
        await tester.pumpWidget(
          screen(const StockVoucherDetailScreen(id: 'document')),
        );
        await tester.pumpAndSettle();
        expect(
          find.text(
            arabic ? 'المخزن: مخزن تجريبي' : 'Warehouse: Test warehouse',
          ),
          findsOneWidget,
        );
        expect(
          find.text(
            arabic ? 'مركز التكلفة: مركز تجريبي' : 'Cost center: Test center',
          ),
          findsOneWidget,
        );
        expect(
          find.text(arabic ? 'IT • صنف تجريبي' : 'IT • Test item'),
          findsOneWidget,
        );
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpWidget(
          screen(const StockVoucherCreateScreen(kind: 'ISSUE')),
        );
        await tester.pumpAndSettle();
        for (final option in [
          (
            arabic ? 'المخزن' : 'Warehouse',
            arabic ? 'WH • مخزن تجريبي' : 'WH • Test warehouse',
          ),
          (
            arabic ? 'مركز التكلفة (مطلوب)' : 'Cost center (required)',
            arabic ? 'CC • مركز تجريبي' : 'CC • Test center',
          ),
          (
            arabic ? 'الصنف' : 'Item',
            arabic ? 'IT • صنف تجريبي' : 'IT • Test item',
          ),
        ]) {
          final field = find.text(option.$1).first;
          await tester.ensureVisible(field);
          await tester.tap(field);
          await tester.pumpAndSettle();
          expect(find.text(option.$2), findsWidgets);
          await tester.tap(find.text(option.$2).last);
          await tester.pumpAndSettle();
        }
      },
    );
  }
  for (final kind in ['RECEIPT', 'ISSUE']) {
    testWidgets('$kind voucher draft protects the routed stock screen exit', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(1600, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(_VoucherApi()),
          currentUserProvider.overrideWithValue(_user),
          appConfigProvider.overrideWithValue(
            AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
          ),
        ],
      );
      addTearDown(container.dispose);
      final router = GoRouter(
        initialLocation: AppRoutes.stock,
        routes: [
          GoRoute(
            path: AppRoutes.dashboard,
            builder: (_, _) =>
                const Scaffold(body: Text('Dashboard destination')),
          ),
          GoRoute(
            path: AppRoutes.stock,
            onExit: (_, state) =>
                container.read(draftExitGuardProvider).canLeave(state.pageKey),
            builder: (context, state) => ErpShell(
              currentPath: AppRoutes.stock,
              child: StockScreen(navigationKey: state.pageKey),
            ),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Stock vouchers'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.text(kind == 'RECEIPT' ? 'New receipt' : 'New issue'),
      );
      await tester.pumpAndSettle();
      final field = find.widgetWithText(TextFormField, 'Counterparty');
      await tester.enterText(field, 'Unsaved department');
      router.go(AppRoutes.dashboard);
      await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextFormField>(field).controller!.text,
        'Unsaved department',
      );
      router.go(AppRoutes.dashboard);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Discard'));
      await tester.pumpAndSettle();
      expect(find.text('Dashboard destination'), findsOneWidget);
    });
  }
  for (final target in ['list', 'detail', 'create', 'history']) {
    testWidgets(
      '$target voucher load shows a safe acknowledged error and retries',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = const Size(1400, 1200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = _FailingLoadApi(target);
        final screen = target == 'list'
            ? const StockVouchersScreen()
            : target == 'detail' || target == 'history'
            ? const StockVoucherDetailScreen(id: 'document')
            : const StockVoucherCreateScreen(kind: 'ISSUE');
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(api),
              currentUserProvider.overrideWithValue(_user),
              appConfigProvider.overrideWithValue(
                AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
              ),
              exportCapabilitiesProvider.overrideWith(
                (ref) async => ExportCapabilities.unknown,
              ),
            ],
            child: MaterialApp(
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: screen,
            ),
          ),
        );
        await tester.pumpAndSettle();
        if (target == 'history') {
          await tester.ensureVisible(find.text('History'));
          await tester.tap(find.text('History'));
          await tester.pumpAndSettle();
        }
        expect(find.text('حسنًا'), findsOneWidget);
        expect(
          find.textContaining('INTERNAL_DIAGNOSTIC_DO_NOT_SHOW'),
          findsNothing,
        );
        await tester.tap(find.text('حسنًا'));
        await tester.pumpAndSettle();
        api.fail = false;
        await tester.ensureVisible(find.text('Retry'));
        await tester.tap(find.text('Retry'));
        await tester.pumpAndSettle();
        expect(find.text('حسنًا'), findsNothing);
        expect(
          find.textContaining('INTERNAL_DIAGNOSTIC_DO_NOT_SHOW'),
          findsNothing,
        );
        if (target == 'list') {
          expect(find.text('No vouchers on this page'), findsOneWidget);
        }
        if (target == 'detail') {
          expect(find.textContaining('SA-1'), findsOneWidget);
        }
        if (target == 'create') expect(find.text('Save draft'), findsOneWidget);
        if (target == 'history') expect(find.text('History'), findsOneWidget);
      },
    );
  }
  for (final kind in ['RECEIPT', 'ISSUE']) {
    testWidgets(
      '$kind voucher retains exact request across an uncertain create',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = const Size(1400, 1200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = _VoucherApi();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(api),
              currentUserProvider.overrideWithValue(_user),
              appConfigProvider.overrideWithValue(
                AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
              ),
            ],
            child: MaterialApp(
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: Builder(
                builder: (context) => Scaffold(
                  body: TextButton(
                    onPressed: () => Navigator.of(context).push<String>(
                      MaterialPageRoute(
                        builder: (_) => StockVoucherCreateScreen(kind: kind),
                      ),
                    ),
                    child: const Text('Open voucher'),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open voucher'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Warehouse').first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('WH • Warehouse').last);
        await tester.pumpAndSettle();
        if (kind == 'ISSUE') {
          await tester.tap(find.text('Cost center (required)'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('CC • Synthetic center').last);
          await tester.pumpAndSettle();
        }
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Counterparty'),
          'Synthetic department',
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Reason'),
          'Synthetic reason',
        );
        await tester.ensureVisible(find.text('Item').first);
        await tester.tap(find.text('Item').first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('IT • Item').last);
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Unit (base by default)'));
        await tester.tap(find.text('Unit (base by default)'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('box').last);
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Quantity in selected unit'),
          '2',
        );
        if (kind == 'RECEIPT') {
          await tester.enterText(
            find.widgetWithText(TextFormField, 'Base unit cost'),
            '7.5',
          );
        }
        await tester.ensureVisible(find.text('Save draft'));
        await tester.tap(find.text('Save draft'));
        await tester.pumpAndSettle();
        expect(api.requests, hasLength(1));
        expect(
          (api.requests.single['lines'] as List).single['quantity'],
          kind == 'ISSUE' ? '-2' : '2',
        );
        expect(
          (api.requests.single['lines'] as List).single['unitName'],
          'box',
        );
        await tester.tap(find.text('حسنًا'));
        await tester.pumpAndSettle();
        await tester.pageBack();
        await tester.pumpAndSettle();
        await tester.tap(find.text('Open voucher'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('Voucher request is unresolved'),
          findsOneWidget,
        );
        expect(find.text('box'), findsOneWidget);
        expect(
          find.widgetWithText(TextFormField, 'Quantity in selected unit'),
          findsOneWidget,
        );
        await tester.tap(find.text('Retry'));
        await tester.pumpAndSettle();
        expect(api.requests, hasLength(2));
        expect(api.requests.last, api.requests.first);
        expect(api.requests.first['idempotencyKey'], isA<String>());
        expect(find.text('Open voucher'), findsOneWidget);
      },
    );
  }
  for (final kind in ['RECEIPT', 'ISSUE']) {
    testWidgets(
      '$kind saved draft keeps the same edit retry after an uncertain response',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = const Size(1400, 1200);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = _EditVoucherApi(kind);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(api),
              currentUserProvider.overrideWithValue(_user),
              appConfigProvider.overrideWithValue(
                AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
              ),
              exportCapabilitiesProvider.overrideWith(
                (ref) async => ExportCapabilities.unknown,
              ),
            ],
            child: MaterialApp(
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const StockVoucherDetailScreen(id: 'document'),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Edit draft'));
        await tester.tap(find.text('Edit draft'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Quantity in selected unit'),
          '3',
        );
        await tester.ensureVisible(find.text('Save draft'));
        await tester.tap(find.text('Save draft'));
        await tester.pumpAndSettle();
        expect(api.edits, hasLength(1));
        expect(api.edits.first['expectedVersion'], 2);
        expect((api.edits.first['lines'] as List).single['id'], 'line');
        expect(
          (api.edits.first['lines'] as List).single['quantity'],
          kind == 'ISSUE' ? '-3' : '3',
        );
        expect((api.edits.first['lines'] as List).single['unitName'], 'box');
        expect(
          (api.edits.first['lines'] as List).single['notes'],
          'Original line note',
        );
        await tester.tap(find.text('حسنًا'));
        await tester.pumpAndSettle();
        await tester.pageBack();
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Edit draft'));
        await tester.tap(find.text('Edit draft'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('Voucher request is unresolved'),
          findsOneWidget,
        );
        await tester.tap(find.text('Retry'));
        await tester.pumpAndSettle();
        expect(api.edits, hasLength(2));
        expect(api.edits.last, api.edits.first);
        expect(api.edits.first['idempotencyKey'], isA<String>());
        expect(find.text('Voucher details'), findsOneWidget);
      },
    );
  }
  testWidgets('voucher item picker loads beyond the first 200 entries', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1400, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _VoucherApi()..paged = true;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(_user),
          appConfigProvider.overrideWithValue(
            AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
          ),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const StockVoucherCreateScreen(kind: 'ISSUE'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Load more items'));
    await tester.tap(find.text('Load more items'));
    await tester.pumpAndSettle();
    expect(api.itemPages, [1, 2]);
    final dropdowns = tester.widgetList<DropdownButton<String>>(
      find.byType(DropdownButton<String>),
    );
    expect(
      dropdowns.any(
        (dropdown) =>
            dropdown.items?.any((item) => item.value == 'item-201') ?? false,
      ),
      isTrue,
    );
  });
  testWidgets('scanning a unit barcode selects that item and unit', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1400, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _VoucherApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(_user),
          appConfigProvider.overrideWithValue(
            AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
          ),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const StockVoucherCreateScreen(kind: 'ISSUE'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final barcode = find.widgetWithText(
      TextFormField,
      'Scan item or unit barcode',
    );
    await tester.enterText(barcode, 'BOX-001');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(api.barcodeQueries, ['/inventory/items/by-barcode/BOX-001']);
    expect(find.text('box'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  // A USB scanner is a keyboard: it types the code and presses Enter. Some
  // models send Enter twice, and a slow request lets the operator press it
  // again. Both put the same item on the document twice unless the line
  // refuses a repeat, so each of those is exercised here rather than assumed.
  Future<_VoucherApi> scanScenario(
    WidgetTester tester,
    Future<void> Function(Finder barcode) act,
  ) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1400, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _VoucherApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(_user),
          appConfigProvider.overrideWithValue(
            AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
          ),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const StockVoucherCreateScreen(kind: 'ISSUE'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await act(
      find.widgetWithText(TextFormField, 'Scan item or unit barcode'),
    );
    await tester.pumpAndSettle();
    return api;
  }

  testWidgets('a scanner that sends Enter twice adds the item once', (
    tester,
  ) async {
    final api = await scanScenario(tester, (barcode) async {
      await tester.enterText(barcode, 'BOX-001');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      // The second Enter arrives with no new text, exactly as a duplicated
      // keystroke from the scanner would.
      await tester.testTextInput.receiveAction(TextInputAction.done);
    });
    expect(api.barcodeQueries, ['/inventory/items/by-barcode/BOX-001'],
        reason: 'the second Enter must not send a second lookup');
    expect(tester.takeException(), isNull);
  });

  testWidgets('pressing Enter again while the lookup runs does not repeat it', (
    tester,
  ) async {
    final api = await scanScenario(tester, (barcode) async {
      await tester.enterText(barcode, 'BOX-001');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.testTextInput.receiveAction(TextInputAction.done);
    });
    expect(api.barcodeQueries.length, 1);
    expect(find.text('box'), findsOneWidget);
  });

  testWidgets('an unknown barcode says so and leaves the line alone', (
    tester,
  ) async {
    final api = await scanScenario(tester, (barcode) async {
      await tester.enterText(barcode, 'NOT-A-CODE');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      // The error dialog is opened after the failed lookup resolves, so the
      // frame that shows it comes after the one scanScenario settles.
      await tester.pumpAndSettle();
    });
    expect(api.barcodeQueries, ['/inventory/items/by-barcode/NOT-A-CODE']);
    // The dialog names the code that failed, in the interface language. The
    // generic "record not found" the resolver would produce says nothing about
    // what was scanned, and an operator holding a label needs the code back.
    expect(
      find.textContaining('No item or unit carries the barcode NOT-A-CODE'),
      findsOneWidget,
      reason: 'the message must name the barcode and say what to do next',
    );
    expect(find.textContaining('search for the item by name'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'editing an issue retains its saved cost center without read permission',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      const limited = AppUser(
        id: 'limited',
        username: 'tester',
        fullName: 'Tester',
        companyId: 'company',
        branchId: 'branch',
        permissions: [
          'inventory.stock.read',
          'inventory.stock.adjust',
          'inventory.items.read',
          'inventory.warehouses.read',
        ],
      );
      final api = _VoucherApi();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            currentUserProvider.overrideWithValue(limited),
            appConfigProvider.overrideWithValue(
              AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
            ),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: StockVoucherCreateScreen(
              kind: 'ISSUE',
              initialDocument: {
                'id': 'document',
                'voucherKind': 'ISSUE',
                'editVersion': 2,
                'documentDate': '2026-11-04',
                'toWarehouseId': 'warehouse',
                'costCenterId': 'center',
                'counterpartyName': 'Department',
                'reason': 'Synthetic',
                'lines': [
                  {
                    'id': 'line',
                    'itemId': 'item',
                    'quantity': '-2',
                    'unitQuantity': '-2',
                    'unitCost': '7',
                  },
                ],
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Saved cost center'), findsOneWidget);
      expect(
        find.text('No active cost centres are available for stock issues.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('voucher search queries the server for the user branch', (
    tester,
  ) async {
    final api = _VoucherApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(_user),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const StockVouchersScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), ' SA-1 ');
    await tester.tap(find.byTooltip('Search'));
    await tester.pumpAndSettle();
    expect(api.listQueries.last, containsPair('q', 'SA-1'));
    expect(api.listQueries.last, containsPair('branchId', 'branch'));
    expect(api.listQueries.last, containsPair('voucherOnly', 'true'));
    expect(api.listQueries.last, containsPair('page', 1));
  });
  testWidgets(
    'limited role cannot see receipt costs review approval or export',
    (tester) async {
      const limited = AppUser(
        id: 'limited',
        username: 'tester',
        fullName: 'Tester',
        companyId: 'company',
        branchId: 'branch',
        permissions: [
          'inventory.stock.read',
          'inventory.stock.adjust',
          'inventory.items.read',
          'inventory.warehouses.read',
        ],
      );
      final api = _VoucherApi();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            currentUserProvider.overrideWithValue(limited),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const StockVouchersScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('New receipt'), findsNothing);
      expect(find.text('New issue'), findsNothing);
      expect(
        find.text('Cost-centre read permission is required to issue stock'),
        findsOneWidget,
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            currentUserProvider.overrideWithValue(limited),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const StockVoucherDetailScreen(id: 'document'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Base unit cost'), findsNothing);
      expect(find.text('Review'), findsNothing);
      expect(find.text('Approve'), findsNothing);
      expect(find.text('Print'), findsNothing);
    },
  );
  testWidgets(
    'voucher workflow refreshes after review approval posting and reversal',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _VoucherApi();
      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(_user),
          appConfigProvider.overrideWithValue(
            AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
          ),
          exportCapabilitiesProvider.overrideWith(
            (ref) async => ExportCapabilities.unknown,
          ),
        ],
      );
      addTearDown(container.dispose);
      expect(
        (await container.read(dashboardSummaryProvider.future))['status'],
        'draft',
      );
      expect(
        (await container.read(dashboardMonthlyProvider.future))['status'],
        'draft',
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const StockVoucherDetailScreen(id: 'document'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Print'));
      await tester.tap(find.text('Print'));
      await tester.pumpAndSettle();
      expect(find.text('Prices in this copy'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      for (final action in ['Review', 'Approve', 'Post', 'Reverse']) {
        expect(find.text(action), findsOneWidget);
        await tester.tap(find.text(action));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();
        if (action == 'Post' || action == 'Reverse') {
          final status = action == 'Post' ? 'posted' : 'reversed';
          expect(
            (await container.read(dashboardSummaryProvider.future))['status'],
            status,
          );
          expect(
            (await container.read(dashboardMonthlyProvider.future))['status'],
            status,
          );
        }
      }
      expect(api.actions, ['review', 'approve', 'post', 'reverse']);
      expect(api.actionVersions, [0, 1, 2, 2]);
      expect(find.textContaining('reversed'), findsOneWidget);
    },
  );
}
