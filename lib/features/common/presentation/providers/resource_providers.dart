import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// Loads a collection endpoint and exposes the standard async states.
///
/// Every list in the application is one of these, so refresh, retry and error
/// handling behave identically everywhere. Subclasses only say where the data
/// lives.
abstract class JsonListController extends AsyncNotifier<List<Json>> {
  String get resourcePath;

  Map<String, dynamic> get resourceQuery => const {};

  @override
  Future<List<Json>> build() => _load();

  Future<List<Json>> _load() async {
    return ref
        .read(apiClientProvider)
        .getList(resourcePath, query: resourceQuery.isEmpty ? null : resourceQuery);
  }

  /// Re-reads the collection, showing the loading state again.
  Future<void> reload() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_load);
  }

  /// Re-reads quietly, keeping the current rows on screen meanwhile.
  Future<void> refreshQuietly() async {
    state = await AsyncValue.guard(_load);
  }
}

/// A collection that is refetched from scratch each time it is asked for.
///
/// Used by pickers, where a stale list would offer a customer that has just
/// been deactivated.
final customersProvider = FutureProvider<List<Json>>((ref) async {
  return ref
      .read(apiClientProvider)
      .getList('/parties/customers', query: const {'includeInactive': 'true'});
});

final suppliersProvider = FutureProvider<List<Json>>((ref) async {
  return ref
      .read(apiClientProvider)
      .getList('/parties/suppliers', query: const {'includeInactive': 'true'});
});

final itemsProvider = FutureProvider<List<Json>>((ref) async {
  return ref
      .read(apiClientProvider)
      .getList('/inventory/items', query: const {'includeInactive': 'true'});
});

final activeItemsProvider = FutureProvider<List<Json>>((ref) async {
  final items = await ref.read(itemsProvider.future);
  return items
      .where((item) => flag(item, 'isActive', fallback: true))
      .toList(growable: false);
});

final activeCustomersProvider = FutureProvider<List<Json>>((ref) async {
  final rows = await ref.read(customersProvider.future);
  return rows
      .where((row) => flag(row, 'isActive', fallback: true))
      .toList(growable: false);
});

final activeSuppliersProvider = FutureProvider<List<Json>>((ref) async {
  final rows = await ref.read(suppliersProvider.future);
  return rows
      .where((row) => flag(row, 'isActive', fallback: true))
      .toList(growable: false);
});
