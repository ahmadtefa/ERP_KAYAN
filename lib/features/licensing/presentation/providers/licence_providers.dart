import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/licence_data_source.dart';

final licenceDataSourceProvider = Provider<LicenceDataSource>(
  (ref) => LicenceDataSource(ref.watch(apiClientProvider)),
);

/// The licence state, read from the server.
///
/// A failure here is **not** treated as "unlicensed": the server's own guard
/// fails open when it cannot read the licence, and a client that locked the
/// screen on a network hiccup would be worse than the problem it imagines.
/// The gate therefore only blocks on a positive `blocked: true`.
final licenceStatusProvider = FutureProvider<LicenceStatus>((ref) async {
  final data = await ref.read(licenceDataSourceProvider).status();
  return LicenceStatus.fromJson(data);
});

/// Applies one key, or confirms the clock, and refreshes the status.
///
/// Returns the error message to show, or `null` on success, which is the same
/// shape the other controllers in the program use.
class LicenceActions {
  LicenceActions(this._ref);

  final Ref _ref;

  Future<String?> apply(String operation, String key) async {
    final trimmed = key.trim();
    if (trimmed.isEmpty) {
      return 'EMPTY';
    }
    try {
      await _ref.read(licenceDataSourceProvider).apply(operation, trimmed);
      _ref.invalidate(licenceStatusProvider);
      return null;
    } on Failure catch (failure) {
      return failure.message;
    } catch (error) {
      return '$error';
    }
  }

  Future<String?> confirmClock() async {
    try {
      await _ref.read(licenceDataSourceProvider).confirmClock();
      _ref.invalidate(licenceStatusProvider);
      return null;
    } on Failure catch (failure) {
      return failure.message;
    } catch (error) {
      return '$error';
    }
  }

  Future<List<Map<String, dynamic>>> events() async {
    final data = await _ref.read(licenceDataSourceProvider).events();
    final items = data['items'];
    if (items is! List) return const [];
    return items
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);
  }
}

final licenceActionsProvider = Provider<LicenceActions>(LicenceActions.new);
