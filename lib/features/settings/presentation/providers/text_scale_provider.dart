import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/preferences/text_scale.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// Owns the program-wide text size and saves the user's choice.
///
/// One value, read by the theme and by the `MediaQuery` scaler at the root, so
/// every screen follows it without knowing that the setting exists.
class TextScaleController extends AsyncNotifier<double> {
  @override
  Future<double> build() async {
    return ref.read(tokenStoreProvider).readTextScale();
  }

  Future<void> set(double value) async {
    final next = normalizeTextScale(value);
    await ref.read(tokenStoreProvider).saveTextScale(next);
    state = AsyncValue.data(next);
  }

  /// Moves one step larger (+1) or smaller (-1); does nothing at the ends.
  Future<void> step(int direction) async {
    final current = state.value ?? kDefaultTextScale;
    final next = stepTextScale(current, direction);
    if (next == null) return;
    await set(next);
  }

  Future<void> reset() => set(kDefaultTextScale);
}

final textScaleControllerProvider =
    AsyncNotifierProvider<TextScaleController, double>(TextScaleController.new);

/// The size the interface should use right now. While the stored value is
/// still being read, the design's own size is used, so the first frame is
/// never built at an arbitrary scale.
final effectiveTextScaleProvider = Provider<double>((ref) {
  return ref.watch(textScaleControllerProvider).value ?? kDefaultTextScale;
});
