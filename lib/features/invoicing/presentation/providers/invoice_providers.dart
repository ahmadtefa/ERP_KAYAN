import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../common/presentation/providers/resource_providers.dart';

/// The two directions a trading document can take. Everything else about them
/// is the same, so one screen serves both.
enum InvoiceKind { sales, purchase }

extension InvoiceKindPaths on InvoiceKind {
  bool get isSales => this == InvoiceKind.sales;

  String get basePath => isSales ? '/sales/invoices' : '/purchases/invoices';

  /// The key under which the API nests the counterparty.
  String get partyKey => isSales ? 'customer' : 'supplier';
}

class SalesInvoicesController extends JsonListController {
  @override
  String get resourcePath => '/sales/invoices';
}

class PurchaseInvoicesController extends JsonListController {
  @override
  String get resourcePath => '/purchases/invoices';
}

final salesInvoicesProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      SalesInvoicesController.new,
    );

final purchaseInvoicesProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      PurchaseInvoicesController.new,
    );

AsyncNotifierProvider<JsonListController, List<Json>> invoiceListProvider(
  InvoiceKind kind,
) => kind.isSales ? salesInvoicesProvider : purchaseInvoicesProvider;

/// The counterparty summary nested inside an invoice row.
Json partyOf(Json invoice, InvoiceKind kind) =>
    invoice[kind.partyKey] is Map
    ? Map<String, dynamic>.from(invoice[kind.partyKey] as Map)
    : const {};
