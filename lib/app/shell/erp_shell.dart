import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../shared/widgets/company_logo.dart';
import '../../features/settings/presentation/providers/locale_provider.dart';
import '../../shared/extensions/l10n_extension.dart';
import '../router/app_router.dart';

/// One entry in the navigation.
class _NavItem {
  const _NavItem(this.path, this.icon, this.label);

  final String path;
  final IconData icon;
  final String label;
}

/// Adaptive chrome around every authenticated screen.
///
/// Breakpoints:
///  * < 900 px  — a drawer, because a bottom bar cannot hold a full ERP
///  * >= 900 px — permanent navigation rail
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
    final branding = ref.watch(companyBrandingProvider).value;
    final logoPath = branding?['logoUrl'] as String?;
    final logoUrl = logoPath == null
        ? null
        : '${ref.watch(appConfigProvider).apiBaseUrl.replaceFirst(RegExp(r'/+$'), '')}$logoPath';

    return Scaffold(
      appBar: AppBar(
        leading: Padding(
          padding: const EdgeInsets.all(8),
          child: CompanyLogo(url: logoUrl, size: 32),
        ),
        title: Text(items[selectedIndex].label),
        actions: const [_LanguageMenu(), _SignOutButton()],
      ),
      drawer: isWide ? null : _ModuleDrawer(items: items, current: currentPath),
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
    );
  }

  List<_NavItem> _navigationItems(BuildContext context) {
    final l10n = context.l10n;
    return [
      _NavItem(AppRoutes.dashboard, Icons.dashboard_outlined, l10n.dashboard),
      _NavItem(
        AppRoutes.journalEntries,
        Icons.menu_book_outlined,
        l10n.journalEntries,
      ),
      _NavItem(
        AppRoutes.fiscalPeriods,
        Icons.event_available_outlined,
        l10n.fiscalPeriods,
      ),
      _NavItem(AppRoutes.customers, Icons.people_outline, l10n.customers),
      _NavItem(
        AppRoutes.suppliers,
        Icons.local_shipping_outlined,
        l10n.suppliers,
      ),
      _NavItem(AppRoutes.items, Icons.category_outlined, l10n.items),
      _NavItem(AppRoutes.stock, Icons.inventory_2_outlined, l10n.stock),
      _NavItem(
        AppRoutes.salesInvoices,
        Icons.point_of_sale_outlined,
        l10n.salesInvoices,
      ),
      _NavItem(
        AppRoutes.purchaseInvoices,
        Icons.shopping_cart_outlined,
        l10n.purchaseInvoices,
      ),
      _NavItem(
        AppRoutes.chartOfAccounts,
        Icons.account_tree_outlined,
        l10n.chartOfAccounts,
      ),
      _NavItem(AppRoutes.reports, Icons.bar_chart_outlined, l10n.reports),
      _NavItem(
        AppRoutes.importData,
        Icons.upload_file_outlined,
        l10n.importData,
      ),
      _NavItem(
        AppRoutes.backup,
        Icons.verified_user_outlined,
        l10n.backupTitle,
      ),
      _NavItem(
        AppRoutes.administration,
        Icons.admin_panel_settings_outlined,
        l10n.administration,
      ),
      _NavItem(AppRoutes.settings, Icons.settings_outlined, l10n.settings),
    ];
  }
}

class _ModuleDrawer extends StatelessWidget {
  const _ModuleDrawer({required this.items, required this.current});

  final List<_NavItem> items;
  final String current;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      child: SafeArea(
        child: ListView(
          children: [
            for (final item in items)
              ListTile(
                leading: Icon(item.icon),
                title: Text(item.label),
                selected: item.path == current,
                onTap: () {
                  Navigator.of(context).pop();
                  context.go(item.path);
                },
              ),
          ],
        ),
      ),
    );
  }
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
