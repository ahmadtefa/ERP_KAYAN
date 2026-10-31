import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/print_settings_data_source.dart';

final printSettingsDataSourceProvider = Provider<PrintSettingsDataSource>(
  (ref) => PrintSettingsDataSource(ref.watch(apiClientProvider)),
);

/// The company's saved print policy, fetched once and kept until it changes.
///
/// The dialog in front of every print button reads this to decide what its
/// boxes start at, so "hide the cost on warehouse prints" is remembered rather
/// than retyped. It is deliberately an ordinary future provider: a print button
/// that cannot reach the server still opens, with the built-in default.
final printSettingsProvider = FutureProvider<PrintSettings>((ref) {
  final user = ref.watch(currentUserProvider);
  if (user == null) {
    return Future.value(
      const PrintSettings(types: [], settings: {}, defaults: PrintPriceSetting(showSalePrice: true, showCost: true), costLocked: true),
    );
  }
  return ref.watch(printSettingsDataSourceProvider).fetch();
});

/// Saves the policy and keeps the screen in step with what the server stored.
class PrintSettingsController extends AsyncNotifier<PrintSettings> {
  @override
  Future<PrintSettings> build() => ref.watch(printSettingsDataSourceProvider).fetch();

  /// Returns an error message, or null on success.
  Future<String?> save(Map<String, PrintPriceSetting> values) async {
    final current = state.asData?.value;
    if (current == null) return 'الإعدادات لم تُحمّل بعد. / The settings have not loaded yet.';
    final keys = <String>[];
    final list = <PrintPriceSetting>[];
    for (final entry in values.entries) {
      keys.add(entry.key);
      list.add(entry.value);
    }
    try {
      final saved = await ref
          .read(printSettingsDataSourceProvider)
          .save(list, keys);
      state = AsyncValue.data(saved);
      // The dialog reads the plain future provider; refresh it too so the next
      // print starts from what was just saved.
      ref.invalidate(printSettingsProvider);
      return null;
    } on Failure catch (failure) {
      return failure.message;
    } catch (error) {
      return '$error';
    }
  }
}

final printSettingsControllerProvider =
    AsyncNotifierProvider<PrintSettingsController, PrintSettings>(
      PrintSettingsController.new,
    );
