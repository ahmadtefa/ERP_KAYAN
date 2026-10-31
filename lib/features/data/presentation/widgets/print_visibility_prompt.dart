import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../settings/data/print_settings_data_source.dart';
import '../../../settings/presentation/providers/print_settings_providers.dart';
import 'price_visibility_dialog.dart';

/// Opens the price dialog at the company's saved policy for one print type.
///
/// This is the single place a print button asks "what may this copy show?", so
/// a warehouse sheet, a list and an invoice all start from the same answer and
/// obey the same order of precedence: the caller's permission is a floor the
/// server enforces, the saved setting for this type decides the starting point,
/// and whatever is changed in the dialog overrides it for this one copy.
Future<PrintVisibilityChoice?> promptPriceVisibility(
  BuildContext context,
  WidgetRef ref, {
  required String typeKey,
  required bool arabic,
}) async {
  // The permission, not the setting, decides whether a cost box can be used at
  // all. `costLocked` from the server says the same thing, and is consulted
  // when the policy has loaded.
  final user = ref.read(currentUserProvider);
  final mayReadCost = user?.can('inventory.cost.read') ?? false;

  // The policy has to be read, not remembered: until something asks for it the
  // provider holds no value, and starting from "everything visible" would mean
  // a company that decided its warehouse sheets leave without costs is asked
  // again on the first print of every session. A server that cannot answer
  // still opens the dialog - the built-in default is the same promise an
  // installation that never saved a policy makes.
  var settings = ref.read(printSettingsProvider).asData?.value;
  if (settings == null && user != null) {
    try {
      settings = await ref.read(printSettingsProvider.future);
    } catch (_) {
      settings = null;
    }
  }
  if (!context.mounted) return null;
  final locked = settings?.costLocked ?? !mayReadCost;
  final start = settings?.forType(typeKey) ??
      const PrintPriceSetting(showSalePrice: true, showCost: true);

  return choosePriceVisibility(
    context,
    arabic: arabic,
    canSeeCost: mayReadCost && !locked,
    initialShowSalePrice: start.showSalePrice,
    // A caller without the permission starts with the cost off rather than
    // ticking and unticking a locked box.
    initialShowCost: mayReadCost && !locked ? start.showCost : false,
    policyNote: arabic
        ? 'يبدأ هذا الاختيار من سياسة الطباعة المحفوظة للشركة؛ أي تغيير هنا يخص هذه النسخة فقط.'
        : 'This starts from the company\'s saved print policy; any change here is for this copy only.',
  );
}
