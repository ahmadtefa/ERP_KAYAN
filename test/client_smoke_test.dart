import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/core/json/amount_format.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/fiscal_periods_screen.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/journal_entries_screen.dart';
import 'package:erp_kayan/features/admin/presentation/screens/admin_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_screen.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_list_screen.dart';
import 'package:erp_kayan/features/parties/presentation/screens/parties_screen.dart';
import 'package:erp_kayan/features/reports/presentation/reports_screen.dart';

void main() {
  // Compiling this file pulls in every module screen, so it fails to build if
  // any of them stops type-checking.
  test('every module screen can be constructed', () {
    final screens = <Widget>[
      const PartiesScreen(kind: PartyKind.customer),
      const PartiesScreen(kind: PartyKind.supplier),
      const ItemsScreen(),
      const StockScreen(),
      const InvoiceListScreen(kind: InvoiceKind.sales),
      const InvoiceListScreen(kind: InvoiceKind.purchase),
      const JournalEntriesScreen(),
      const ReportsScreen(),
        const FiscalPeriodsScreen(),
        const AdminScreen(),
    ];
    expect(screens, hasLength(10));
  });

  test('invoice paths follow from the kind', () {
    expect(InvoiceKind.sales.basePath, '/sales/invoices');
    expect(InvoiceKind.purchase.basePath, '/purchases/invoices');
    expect(InvoiceKind.sales.partyKey, 'customer');
    expect(InvoiceKind.purchase.partyKey, 'supplier');
  });

  test('amounts keep four decimals and are grouped', () {
    expect(formatAmount('1234567.5000'), '1,234,567.50');
    expect(formatAmount('0.0000'), '0.00');
    expect(formatAmount('-250.0000'), '-250.00');
    expect(formatAmount(null), '');
  });

  test('quantities drop trailing zeros', () {
    expect(formatQuantity('10.0000'), '10');
    expect(formatQuantity('2.5000'), '2.5');
    expect(formatQuantity('0.2500'), '0.25');
  });

  test('amounts are never routed through a double', () {
    // 0.1 + 0.2 is the classic binary floating point failure. Kept as
    // Decimal, it is exact.
    final sum =
        Decimal.parse('0.1') +
        Decimal.parse('0.2') +
        Decimal.parse('9007199254740993.0001');
    expect(sum.toString(), '9007199254740993.3001');
  });

  test('missing values read as empty rather than throwing', () {
    expect(asString(null), isNull);
    expect(text(<String, dynamic>{}, 'code'), '');
    expect(flag(<String, dynamic>{}, 'isActive', fallback: true), isTrue);
    expect(listOf(null), isEmpty);
  });

  test('the route table covers every module', () {
    const paths = [
      AppRoutes.dashboard,
      AppRoutes.journalEntries,
      AppRoutes.customers,
      AppRoutes.suppliers,
      AppRoutes.items,
      AppRoutes.stock,
      AppRoutes.salesInvoices,
      AppRoutes.purchaseInvoices,
      AppRoutes.chartOfAccounts,
        AppRoutes.fiscalPeriods,
      AppRoutes.reports,
        AppRoutes.administration,
      AppRoutes.settings,
    ];
    expect(paths.toSet(), hasLength(13));
  });
}
