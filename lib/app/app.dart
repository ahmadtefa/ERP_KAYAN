import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/settings/presentation/providers/locale_provider.dart';
import '../l10n/generated/app_localizations.dart';
import '../shared/extensions/l10n_extension.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';

/// Application root.
///
/// Locale selection drives both translation and text direction: setting the
/// locale to Arabic makes Flutter lay the whole tree out right-to-left.
class ErpApp extends ConsumerWidget {
  const ErpApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final locale = ref.watch(localeControllerProvider).value;

    return MaterialApp.router(
      onGenerateTitle: (context) => context.l10n.appTitle,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      routerConfig: router,
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    );
  }
}
