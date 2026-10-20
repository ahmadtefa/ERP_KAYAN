import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// The whole hierarchy, with a depth per row, exactly as the API returns it.
///
/// The tree endpoint is used rather than the paginated list: a parent selector
/// and an indented list both need every centre, and a company with more than
/// one page of centres would otherwise silently lose the tail.
final costCentersProvider = FutureProvider<List<Json>>((ref) async {
  final page = await ref.read(apiClientProvider).getObject(
    '/accounting/cost-centers/tree',
    query: const {'includeInactive': 'true'},
  );
  return listOf(page['items']);
});

/// The centres a new posting may name today: active, and nothing else.
final activeCostCentersProvider = FutureProvider<List<Json>>((ref) async {
  final rows = await ref.watch(costCentersProvider.future);
  return rows
      .where((row) => flag(row, 'isActive', fallback: true))
      .toList(growable: false);
});

/// "PRJ-1 — Project one", in the language on screen, with the same fallback
/// rule as every other bilingual label.
String costCenterLabel(Json row, String languageCode) {
  final preferred = languageCode == 'ar' ? text(row, 'nameAr') : text(row, 'nameEn');
  final other = languageCode == 'ar' ? text(row, 'nameEn') : text(row, 'nameAr');
  final name = preferred.trim().isNotEmpty ? preferred : other;
  final code = text(row, 'code');
  return name.isEmpty ? code : '$code — $name';
}
