import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';

/// Cash boxes and bank accounts, and the money that moves through them.
///
/// Every list here is the same [JsonListController] the other screens use, so
/// loading, refreshing, retrying and failing behave the way they do in the
/// rest of the program.

class CashAccountsController extends JsonListController {
  @override
  String get resourcePath => '/cash/accounts';

  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

class CashVouchersController extends JsonListController {
  @override
  String get resourcePath => '/cash/vouchers';
}

class CashTransfersController extends JsonListController {
  @override
  String get resourcePath => '/cash/transfers';
}

final cashAccountsProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      CashAccountsController.new,
    );

final cashVouchersProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      CashVouchersController.new,
    );

final cashTransfersProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      CashTransfersController.new,
    );

/// One voucher with the invoices it settled and the journal entries it wrote.
/// The list is a table; this is the chain behind one row of it: receipt ->
/// invoice -> entry, which is the question an auditor actually asks.
final cashVoucherProvider = FutureProvider.family<Json, String>((ref, id) async {
  return ref.read(apiClientProvider).getObject('/cash/vouchers/$id');
});

/// What each box and bank holds, read from the ledger rather than from a
/// stored total that could drift away from it.
final cashBalancesProvider = FutureProvider<List<Json>>((ref) async {
  final data = await ref
      .read(apiClientProvider)
      .getObject('/cash/accounts/balances');
  return listOf(data['rows']);
});

/// The invoices a party still owes, or is still owed, so a receipt or a
/// payment can be pointed at the documents it settles.
final openInvoicesProvider =
    FutureProvider.family<List<Json>, ({String kind, String partyId})>((
      ref,
      key,
    ) async {
      final data = await ref
          .read(apiClientProvider)
          .getObject('/cash/open-invoices/${key.kind}/${key.partyId}');
      return listOf(data['items']);
    });

/// Everything that moved through one box, with a running balance.
final cashStatementProvider = FutureProvider.family<List<Json>, String>((
  ref,
  cashAccountId,
) async {
  final data = await ref
      .read(apiClientProvider)
      .getObject('/cash/accounts/$cashAccountId/statement');
  return listOf(data['movements']);
});
