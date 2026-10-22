import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/data/datasources/chart_of_accounts_data_source.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/chart_of_accounts_screen.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_detail_dialog.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/records_table.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Wide financial tables on real screen sizes.
///
/// §5 of the mandate: on a phone, wide tables used to arrive squeezed —
/// numbers wrapped at commas, headings stacked into towers, labels and
/// values fighting over one line. The shared table now grows its
/// columns and scrolls sideways (numbers never wrap), and its narrow
/// card form stacks label over value at full width. These tests run
/// the shared table and three real screens at desktop, tablet and two
/// phone widths with Arabic and English text, long cells, dates and
/// seven-figure amounts, and demand: no overflow exception, whole
/// amounts present as one unbroken string, nothing hidden.
const _widths = [1366.0, 768.0, 390.0, 320.0];

void _size(WidgetTester tester, double width) {
  tester.view.physicalSize = Size(width, width > 700 ? 900 : 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Widget _app(
  Widget home, {
  ChartOfAccountsDataSource? chartSource,
  ApiClient? api,
}) {
  return ProviderScope(
    overrides: [
      currentUserProvider.overrideWithValue(testUser),
      if (chartSource != null)
        chartOfAccountsDataSourceProvider.overrideWithValue(chartSource),
      if (api != null) apiClientProvider.overrideWithValue(api),
    ],
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: home),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const rows = <Json>[
    {
      'code': '1104',
      'nameAr': 'مخزون المواد الخام وقطع الغيار بالمخزن الرئيسي بالمنطقة الصناعية',
      'nameEn': 'Raw materials and spare parts — main industrial warehouse',
      'date': '2024-12-31',
      'debit': '1,234,567.89',
      'credit': '987,654.32',
      'closing': '246,913.57',
      'note': 'رصيد مطابق لكشوف الجرد الفعلي نهاية السنة المالية',
    },
    {
      'code': '2101',
      'nameAr': 'الموردون — حسابات دائنة تجارية طويلة الاسم جدًا للاختبار',
      'nameEn': 'Trade payables to local and foreign suppliers combined',
      'date': '2024-12-31',
      'debit': '55,000.00',
      'credit': '1,234,567.89',
      'closing': '1,179,567.89',
      'note': 'Includes December purchases not yet due for payment',
    },
  ];

  List<ColumnSpec> columns() => [
    ColumnSpec('Code', value: (r) => text(r, 'code'), emphasise: true),
    ColumnSpec('الحساب بالعربية', value: (r) => text(r, 'nameAr')),
    ColumnSpec('Account (English)', value: (r) => text(r, 'nameEn')),
    ColumnSpec('Date', value: (r) => text(r, 'date')),
    ColumnSpec('Debit', numeric: true, value: (r) => text(r, 'debit')),
    ColumnSpec('Credit', numeric: true, value: (r) => text(r, 'credit')),
    ColumnSpec('Closing', numeric: true, value: (r) => text(r, 'closing')),
    ColumnSpec('Note', value: (r) => text(r, 'note')),
  ];

  for (final width in _widths) {
    testWidgets('a wide financial table is whole and unbroken at ${width}px', (
      tester,
    ) async {
      _size(tester, width);
      await tester.pumpWidget(
        _app(RecordsTable(rows: rows, columns: columns())),
      );
      await tester.pumpAndSettle();

      expect(
        tester.takeException(),
        isNull,
        reason: 'no RenderFlex overflow at ${width}px',
      );
      // The seven-figure amount exists as one unbroken piece of text —
      // never split at a comma across lines.
      expect(find.text('1,234,567.89'), findsWidgets);
      expect(find.text('246,913.57'), findsWidgets);
      // Nothing was hidden to make it fit: both languages are present.
      expect(find.textContaining('مخزون المواد الخام'), findsWidgets);
      expect(find.textContaining('Trade payables'), findsWidgets);

      if (width == 768.0) {
        // Table form: the far columns start off-screen and a sideways
        // drag brings the last heading into view.
        final before = tester.getTopLeft(find.text('Note')).dx;
        // Drag from a point that is actually on screen — the centre
        // of a 2,500px-wide table is not inside a 768px viewport.
        await tester.dragFrom(
          tester.getCenter(find.text('1104')),
          const Offset(-500, 0),
        );
        await tester.pumpAndSettle();
        final after = tester.getTopLeft(find.text('Note')).dx;
        expect(after, lessThan(before),
            reason: 'the table actually scrolls sideways');
        expect(tester.takeException(), isNull);
      }
    });
  }

  testWidgets('the chart of accounts reads cleanly on a phone', (tester) async {
    _size(tester, 390);
    await tester.pumpWidget(
      _app(const ChartOfAccountsScreen(), chartSource: _ChartSource()),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.textContaining('1104'), findsWidgets);
    expect(find.textContaining('raw materials'), findsWidgets);
  });

  testWidgets('a purchase invoice document reads cleanly on a phone', (
    tester,
  ) async {
    _size(tester, 390);
    await tester.pumpWidget(
      _app(
        // The real app mounts this inside a bounded data dialog; the
        // box reproduces that instead of an unbounded scaffold body.
        const SizedBox(
          height: 760,
          child: InvoiceDetailDialog(
            kind: InvoiceKind.purchase,
            summary: {'id': 'inv-1', 'invoiceNumber': 'PI-1'},
          ),
        ),
        api: _InvoiceApi(),
      ),
    );
    // Bounded pumps rather than pumpAndSettle: the export-actions
    // capabilities probe can keep a spinner alive in a test binding.
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }

    expect(tester.takeException(), isNull);
    // The line total, formatted by the screen, whole and unsplit.
    expect(find.text('1,234,567.89'), findsWidgets);
  });
}

class _ChartSource implements ChartOfAccountsDataSource {
  @override
  Future<List<Account>> fetchAccounts() async => const [
    Account(
      id: 'a1',
      companyId: 'company-1',
      code: '1',
      name: 'Assets',
      nameEn: 'Assets',
      nameAr: 'الأصول',
      type: AccountType.asset,
      isPostable: false,
    ),
    Account(
      id: 'a2',
      companyId: 'company-1',
      code: '1104',
      name: 'Inventory',
      nameEn: 'Inventory — raw materials and spare parts, main warehouse',
      nameAr: 'مخزون المواد الخام وقطع الغيار بالمخزن الرئيسي',
      type: AccountType.asset,
      // Top-level on purpose: the tree starts collapsed, and this
      // test is about narrow layout, not about expanding nodes.
      cashFlowClass: 'OPERATING',
    ),
    Account(
      id: 'a3',
      companyId: 'company-1',
      code: '3101',
      name: 'Capital',
      nameEn: 'Capital',
      nameAr: 'رأس المال',
      type: AccountType.equity,
      cashFlowClass: 'FINANCING',
    ),
  ];

  @override
  Future<Account> createAccount(AccountInput input) =>
      throw UnimplementedError();

  @override
  Future<Account> updateAccount(String id, AccountInput input) =>
      throw UnimplementedError();

  @override
  Future<void> deleteAccount(String id) => throw UnimplementedError();

  @override
  Future<String> suggestCode({String? parentId}) async => '9999';
}

class _InvoiceApi extends ApiClient {
  _InvoiceApi()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {};

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path.contains('capabilities')) {
      return {'formats': ['xlsx', 'csv'], 'pdf': false};
    }
    return {
      'id': 'inv-1',
      'invoiceNumber': 'PI-1',
      'status': 'posted',
      'invoiceDate': '2025-03-01',
      'supplierNameEn': 'Long Supplier Name For Testing',
      'lines': [
        {
          'lineNumber': 1,
          'itemCode': 'MCH-1',
          'itemNameEn': 'Industrial press machine with a long name',
          'description': 'ماكينة كبس صناعية بوصف عربي طويل للاختبار',
          'quantity': '2.0000',
          'unitPrice': '617283.9450',
          'lineTotal': '1234567.8900',
          'taxAmount': '0.0000',
          'discountAmount': '0.0000',
          'costTotal': '1234567.8900',
        },
      ],
    };
  }
}
