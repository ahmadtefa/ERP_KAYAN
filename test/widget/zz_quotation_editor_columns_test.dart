import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

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

  String? postPath;
  Map<String, dynamic>? postBody;
  Map<String, dynamic>? objectResponse;

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => objectResponse ?? const {};

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    postPath = path;
    postBody = Map<String, dynamic>.from(body! as Map);
    return {'id': 'quotation-id'};
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpEditor(
    WidgetTester tester,
    _FakeApiClient api, {
    String? quotationId,
  }) async {
    // A tall surface: the editor is a long form, and tests below assert on
    // widgets far down it (per-table grid previews, line fields).
    tester.view.physicalSize = const Size(1600, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          itemsProvider.overrideWith((ref) async => [
            {
              'id': 'item-1',
              'code': 'ITEM-1',
              'nameEn': 'Widget',
              'nameAr': 'صنف',
              'unit': 'piece',
              'isActive': true,
              'isStockTracked': true,
              'taxRate': '0.0000',
              'salePrice': '100.0000',
            },
          ]),
          customersProvider.overrideWith((ref) async => [
            {
              'id': 'customer-1',
              'code': 'CUS-1',
              'nameEn': 'Test customer',
              'nameAr': 'عميل تجريبي',
              'isActive': true,
            },
          ]),
        ],
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: GoRouter(
            initialLocation: '/new',
            routes: [
              GoRoute(
                path: '/new',
                builder: (context, state) =>
                    QuotationEditorScreen(quotationId: quotationId),
              ),
              GoRoute(
                path: AppRoutes.quotations,
                builder: (context, state) =>
                    const Scaffold(body: Text('quotation list')),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> addNamedColumn(
    WidgetTester tester, {
    String? nameAr,
    String? nameEn,
  }) async {
    await tester.tap(find.byKey(const ValueKey('add-column')));
    await tester.pumpAndSettle();
    if (nameAr != null) {
      await tester.enterText(
        find.byKey(const ValueKey('new-column-name-ar')),
        nameAr,
      );
    }
    if (nameEn != null) {
      await tester.enterText(
        find.byKey(const ValueKey('new-column-name-en')),
        nameEn,
      );
    }
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('confirm-add-column')));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'add column creates named Arabic and English columns in the grid, and their values save with the line',
    (tester) async {
      final api = _FakeApiClient();
      await pumpEditor(tester, api);
      printOnFailure('STEP-OK pumped');

      await tester.tap(find.byKey(const ValueKey('edit-columns-0')));
      await tester.pumpAndSettle();
      printOnFailure('STEP-OK columns dialog open');
      await addNamedColumn(tester, nameAr: 'مدة الضمان');
      printOnFailure('STEP-OK arabic column added');
      // Still inside the layout dialog: the new column is listed by the
      // name that was typed, not by a built-in name or a generated key.
      // (The row can sit below the dialog list's fold, hence skipOffstage.)
      expect(find.text('مدة الضمان', skipOffstage: false), findsWidgets);
      await addNamedColumn(tester, nameEn: 'Lead time');
      printOnFailure('STEP-OK english column added');
      await tester.tap(find.byKey(const ValueKey('save-columns')));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      printOnFailure('STEP-OK columns saved, dialog closed');

      // The editor grid gained two COLUMNS (6 standard + 2 new), not rows.
      await tester.ensureVisible(
        find.byType(DataTable, skipOffstage: false).first,
      );
      await tester.pumpAndSettle();
      final grid = tester.widget<DataTable>(
        find.byType(DataTable, skipOffstage: false).first,
      );
      printOnFailure('STEP-OK grid visible');
      expect(grid.columns, hasLength(8));
      printOnFailure('STEP-OK grid has 8 columns');
      expect(find.text('مدة الضمان', skipOffstage: false), findsWidgets);
      expect(find.text('Lead time', skipOffstage: false), findsWidgets);

      // The line gained a value field under the Arabic name.
      final warrantyField = find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.labelText == 'مدة الضمان',
        skipOffstage: false,
      );
      await tester.ensureVisible(warrantyField);
      await tester.enterText(warrantyField, 'سنتان');
      printOnFailure('STEP-OK warranty value entered');
      await tester.pump();

      // Fill the minimum and save. Scroll back up first: the customer
      // dropdown sits at the top of the form, far above the grid.
      await tester.ensureVisible(
        find.byKey(const ValueKey('quotation-subject'), skipOffstage: false),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('CUS-1 — Test customer').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('quotation-table-title-0')),
        'Main table',
      );
      await tester.tap(find.byKey(const ValueKey('quotation-item-null')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ITEM-1 — Widget').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('quotation-qty-0-0')),
        '2',
      );
      await tester.enterText(
        find.byKey(const ValueKey('quotation-price-0-0')),
        '50',
      );
      await tester.pump();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      final body = api.postBody!;
      final tables = (body['tables'] as List).cast<Map>();
      final tableColumns = (tables.single['columns'] as List).cast<Map>();
      expect(tableColumns, hasLength(8));
      final custom = tableColumns
          .where((column) => '${column['key']}'.startsWith('custom-'))
          .toList();
      expect(custom, hasLength(2));
      expect(custom[0]['labelAr'], 'مدة الضمان');
      expect(custom[0]['kind'], 'text');
      expect(custom[1]['labelEn'], 'Lead time');

      final lines = (tables.single['lines'] as List).cast<Map>();
      final values = Map<String, dynamic>.from(
        lines.single['customValues'] as Map,
      );
      expect(values.values, contains('سنتان'));
      expect(values.keys.single, custom[0]['key']);
    },
  );

  testWidgets('each table keeps its own columns', (tester) async {
    final api = _FakeApiClient();
    await pumpEditor(tester, api);

    // Second table.
    await tester.ensureVisible(find.text('Add table', skipOffstage: false));
    await tester.tap(find.text('Add table'));
    await tester.pumpAndSettle();

    // Give only the second table an extra column.
    await tester.ensureVisible(
      find.byKey(const ValueKey('edit-columns-1'), skipOffstage: false),
    );
    await tester.tap(find.byKey(const ValueKey('edit-columns-1')));
    await tester.pumpAndSettle();
    await addNamedColumn(tester, nameAr: 'الضمان');
    await tester.tap(find.byKey(const ValueKey('save-columns')));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);

    final grids = tester
        .widgetList<DataTable>(find.byType(DataTable, skipOffstage: false))
        .toList();
    expect(grids, hasLength(2));
    expect(grids[0].columns, hasLength(6));
    expect(grids[1].columns, hasLength(7));
  });

  testWidgets(
    'reopening a saved quotation restores per-table columns and custom values',
    (tester) async {
      final api = _FakeApiClient()
        ..objectResponse = {
          'id': 'quotation-9',
          'quotationNumber': 'QT-9',
          'quotationDate': '2026-10-01',
          'currency': 'EGP',
          'customer': {'id': 'customer-1', 'code': 'CUS-1'},
          'columns': [
            {'key': 'description', 'visible': true, 'width': 4},
          ],
          'tables': [
            {
              'id': 'table-1',
              'title': 'Saved table',
              'discountType': null,
              'discountPercent': '0.0000',
              'discountAmount': '0.0000',
              'columns': [
                {'key': 'description', 'visible': true, 'width': 4},
                {
                  'key': 'custom-warranty',
                  'labelAr': 'مدة الضمان',
                  'labelEn': 'Warranty',
                  'visible': true,
                  'width': 2,
                  'kind': 'text',
                },
                {'key': 'lineTotal', 'visible': true, 'width': 2},
              ],
              'lines': [
                {
                  'id': 'line-1',
                  'description': 'Fridge',
                  'quantity': '1.0000',
                  'unitPrice': '100.0000',
                  'customValues': {'custom-warranty': 'سنتان'},
                },
              ],
            },
          ],
        };
      await pumpEditor(tester, api, quotationId: 'quotation-9');

      // The saved layout came back: the grid shows the saved header, and
      // the line's stored value is in its field again.
      await tester.ensureVisible(
        find.byType(DataTable, skipOffstage: false).first,
      );
      await tester.pumpAndSettle();
      final grid = tester.widget<DataTable>(
        find.byType(DataTable, skipOffstage: false).first,
      );
      expect(grid.columns, hasLength(3));
      expect(find.text('مدة الضمان', skipOffstage: false), findsWidgets);
      expect(
        find.widgetWithText(TextField, 'سنتان', skipOffstage: false),
        findsOneWidget,
      );
    },
  );
}
