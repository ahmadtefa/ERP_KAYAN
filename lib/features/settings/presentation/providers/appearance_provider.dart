import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_providers.dart';

/// Device-local presentation only. Matches locale/text size persistence and
/// never carries company, user, permission or financial data between accounts.
class Appearance {
  const Appearance({this.light = false, this.topNavigation = false});
  final bool light;
  final bool topNavigation;
}

class AppearanceController extends AsyncNotifier<Appearance> {
  @override
  Future<Appearance> build() async {
    final store = ref.read(tokenStoreProvider);
    return Appearance(
      light: await store.readAppearance('theme') == 'light',
      topNavigation: await store.readAppearance('navigation') == 'top',
    );
  }

  Future<void> setTheme(bool light) async {
    await future;
    await ref
        .read(tokenStoreProvider)
        .saveAppearance('theme', light ? 'light' : 'dark');
    state = AsyncData(
      Appearance(
        light: light,
        topNavigation: state.value?.topNavigation ?? false,
      ),
    );
  }

  Future<void> setNavigation(bool top) async {
    await future;
    await ref
        .read(tokenStoreProvider)
        .saveAppearance('navigation', top ? 'top' : 'sidebar');
    state = AsyncData(
      Appearance(light: state.value?.light ?? false, topNavigation: top),
    );
  }
}

final appearanceProvider =
    AsyncNotifierProvider<AppearanceController, Appearance>(
      AppearanceController.new,
    );
