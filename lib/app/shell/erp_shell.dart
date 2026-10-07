import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/settings/presentation/providers/locale_provider.dart';
import '../../shared/extensions/l10n_extension.dart';
import '../router/app_router.dart';

/// Adaptive chrome around every authenticated screen.
///
/// Breakpoints:
///  * < 900 px  — bottom navigation bar (phones, small tablets)
///  * >= 900 px — permanent navigation rail (tablets landscape, desktops)
///  * >= 1280 px — the rail is extended and shows labels next to icons
///
/// This is deliberately not a stretched desktop layout: the navigation model
/// itself changes with the available width.
class ErpShell extends ConsumerWidget {
  const ErpShell({super.key, required this.currentPath, required this.child});

  final String currentPath;
  final Widget child;

  static const _wideBreakpoint = 900.0;
  static const _extendedBreakpoint = 1280.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final width = MediaQuery.sizeOf(context).width;
    final isWide = width >= _wideBreakpoint;
    final items = _navigationItems(context);
    final selectedIndex = items
        .indexWhere((item) => item.path == currentPath)
        .clamp(0, items.length - 1);

    return Scaffold(
      appBar: AppBar(
        title: Text(items[selectedIndex].label),
        actions: const [_LanguageMenu(), _SignOutButton()],
      ),
      body: isWide
          ? Row(
              children: [
                NavigationRail(
                  extended: width >= _extendedBreakpoint,
                  selectedIndex: selectedIndex,
                  onDestinationSelected: (index) =>
                      context.go(items[index].path),
                  destinations: [
                    for (final item in items)
                      NavigationRailDestination(
                        icon: Icon(item.icon),
                        label: Text(item.label),
                      ),
                  ],
                ),
                const VerticalDivider(width: 1),
                Expanded(child: child),
              ],
            )
          : child,
      bottomNavigationBar: isWide
          ? null
          : NavigationBar(
              selectedIndex: selectedIndex,
              onDestinationSelected: (index) => context.go(items[index].path),
              destinations: [
                for (final item in items)
                  NavigationDestination(
                    icon: Icon(item.icon),
                    label: item.label,
                  ),
              ],
            ),
    );
  }

  List<_NavItem> _navigationItems(BuildContext context) {
    final l10n = context.l10n;
    return [
      _NavItem(AppRoutes.dashboard, Icons.dashboard_outlined, l10n.dashboard),
      _NavItem(
        AppRoutes.chartOfAccounts,
        Icons.account_tree_outlined,
        l10n.chartOfAccounts,
      ),
      _NavItem(AppRoutes.settings, Icons.settings_outlined, l10n.settings),
    ];
  }
}

class _NavItem {
  const _NavItem(this.path, this.icon, this.label);

  final String path;
  final IconData icon;
  final String label;
}

class _LanguageMenu extends ConsumerWidget {
  const _LanguageMenu();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final current = ref.watch(localeControllerProvider).value;
    return PopupMenuButton<Locale?>(
      icon: const Icon(Icons.translate),
      tooltip: l10n.language,
      initialValue: current,
      onSelected: (locale) =>
          ref.read(localeControllerProvider.notifier).setLocale(locale),
      itemBuilder: (context) => [
        PopupMenuItem<Locale?>(value: null, child: Text(l10n.systemDefault)),
        PopupMenuItem(value: const Locale('en'), child: Text(l10n.english)),
        PopupMenuItem(value: const Locale('ar'), child: Text(l10n.arabic)),
      ],
    );
  }
}

class _SignOutButton extends ConsumerWidget {
  const _SignOutButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return IconButton(
      icon: const Icon(Icons.logout),
      tooltip: context.l10n.signOut,
      onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
    );
  }
}
