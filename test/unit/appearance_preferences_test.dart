import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/providers/appearance_provider.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FailingStore extends TokenStore {
  @override
  Future<String?> readAppearance(String key) async => null;
  @override
  Future<void> saveAppearance(String key, String value) async =>
      throw StateError('Synthetic storage refusal');
}

void main() {
  test('storage refusal leaves active appearance unchanged', () async {
    final container = ProviderContainer(
      overrides: [tokenStoreProvider.overrideWithValue(_FailingStore())],
    );
    addTearDown(container.dispose);
    await container.read(appearanceProvider.future);
    await expectLater(
      container.read(appearanceProvider.notifier).setTheme(true),
      throwsStateError,
    );
    expect(container.read(appearanceProvider).value!.light, false);
  });

  test('display choices default dark/sidebar and persist independently across restart', () async {
    SharedPreferences.setMockInitialValues({});
    final store = TokenStore();
    ProviderContainer create() => ProviderContainer(
      overrides: [tokenStoreProvider.overrideWithValue(store)],
    );
    var container = create();
    var value = await container.read(appearanceProvider.future);
    expect(value.light, false);
    expect(value.topNavigation, false);
    await container.read(appearanceProvider.notifier).setTheme(true);
    await container.read(appearanceProvider.notifier).setNavigation(true);
    container.dispose();
    container = create();
    value = await container.read(appearanceProvider.future);
    expect(value.light, true);
    expect(value.topNavigation, true);
    await container.read(appearanceProvider.notifier).setTheme(false);
    expect(container.read(appearanceProvider).value!.topNavigation, true);
    container.dispose();
    container = create();
    value = await container.read(appearanceProvider.future);
    expect(value.light, false);
    expect(value.topNavigation, true);
    container.dispose();
  });
  test('simultaneous choices preserve both independent dimensions', () async {
    SharedPreferences.setMockInitialValues({});
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await container.read(appearanceProvider.future);
    final controller = container.read(appearanceProvider.notifier);
    await Future.wait([
      controller.setTheme(true),
      controller.setNavigation(true),
    ]);
    expect(container.read(appearanceProvider).value!.light, true);
    expect(container.read(appearanceProvider).value!.topNavigation, true);
  });
  test('invalid saved choices use current safe defaults', () async {
    SharedPreferences.setMockInitialValues({
      'kayan.appearance.theme': 'invalid',
      'kayan.appearance.navigation': 'invalid',
    });
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final value = await container.read(appearanceProvider.future);
    expect(value.light, false);
    expect(value.topNavigation, false);
  });
}
