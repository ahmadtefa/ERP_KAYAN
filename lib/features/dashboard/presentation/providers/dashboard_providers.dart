import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../reports/presentation/report_providers.dart';

/// The server-side dashboard figures.
///
/// The numbers come from the ledger and the documents on the server - not
/// from counting the first page of invoice lists on the client - so the
/// dashboard always agrees with the reports behind it.
final dashboardSummaryProvider = FutureProvider<Json>((ref) async {
  return ref.read(apiClientProvider).getObject('/dashboard/summary');
});

/// Month-by-month totals behind the dashboard charts.
final dashboardMonthlyProvider = FutureProvider<Json>((ref) async {
  return ref.read(apiClientProvider).getObject(
        '/dashboard/monthly',
        query: const {'months': '12'},
      );
});

/// A committed transaction (or an unknown response after one) can change
/// headline figures, the monthly chart and cached financial reports. Invalidate
/// together so previously visited views cannot silently show old figures.
void invalidateDashboardAndReports(WidgetRef ref) {
  ref.invalidate(dashboardSummaryProvider);
  ref.invalidate(dashboardMonthlyProvider);
  ref.invalidate(reportProvider);
}

/// One query box across documents, partners and items.
final globalSearchProvider =
    FutureProvider.family<Json, String>((ref, query) async {
  if (query.trim().length < 2) return <String, dynamic>{'results': []};
  return ref
      .read(apiClientProvider)
      .getObject('/search', query: {'q': query});
});
