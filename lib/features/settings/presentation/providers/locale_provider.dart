import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_providers.dart';

/// Owns the active locale and persists the user's choice.
///
/// `null` means "follow the operating system locale".
class LocaleController extends AsyncNotifier<Locale?> {
  @override
  Future<Locale?> build() async {
    final saved = await ref.read(tokenStoreProvider).readLocale();
    if (saved == null || saved.isEmpty) return null;
    return Locale(saved);
  }

  Future<void> setLocale(Locale? locale) async {
    await ref.read(tokenStoreProvider).saveLocale(locale?.languageCode ?? '');
    state = AsyncValue.data(locale);
  }
}

final localeControllerProvider =
    AsyncNotifierProvider<LocaleController, Locale?>(LocaleController.new);
