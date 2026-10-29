import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';

/// One partner's card - what is invoiced, what is paid, what is still owed.
///
/// The key is the path itself (`/parties/customers/summary/<id>`), because the
/// same card serves both kinds of partner and the address already says which.
final partySummaryProvider = FutureProvider.family<Json, String>((
  ref,
  path,
) async {
  return ref.read(apiClientProvider).getObject(path);
});

/// One partner's statement for a period.
///
/// It lives here rather than beside the dialog that draws it because money
/// moving elsewhere changes it: a receipt or a payment saved on the cash
/// screen has to make every open statement re-read itself, and that screen
/// cannot reach into a widget file to invalidate a provider.
final partyStatementProvider = FutureProvider.family<Json, String>((
  ref,
  path,
) async {
  return ref.read(apiClientProvider).getObject(path);
});

/// The customers screen's own table: every customer, active or not, with the
/// balance the server carries for them.
class CustomersController extends JsonListController {
  @override
  String get resourcePath => '/parties/customers';

  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

class SuppliersController extends JsonListController {
  @override
  String get resourcePath => '/parties/suppliers';

  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

final customersListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      CustomersController.new,
    );

final suppliersListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      SuppliersController.new,
    );
