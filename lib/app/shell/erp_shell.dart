import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/search/presentation/search_dialog.dart';
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
class ErpShell extends ConsumerStatefulWidget {
  const ErpShell({super.key, required this.currentPath, required this.child});

  final String currentPath;
  final Widget child;

  static const _wideBreakpoint = 900.0;
  static const _extendedBreakpoint = 1280.0;

  @override
  ConsumerState<ErpShell> createState() => _ErpShellState();
}

class _ErpShellState extends ConsumerState<ErpShell> {
  final ScrollController _navScrollController = ScrollController();

  @override
  void dispose() {
    _navScrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final isWide = width >= ErpShell._wideBreakpoint;
    final isExtended = width >= ErpShell._extendedBreakpoint;
    final items = _navigationItems(context);
    final selectedIndex = items
        .indexWhere((item) => item.path == widget.currentPath)
        .clamp(0, items.length - 1);

    return Scaffold(
      appBar: AppBar(
        leadingWidth: 56,
        leading: Padding(
          padding: const EdgeInsets.all(9),
          child: Image.asset('1.png', fit: BoxFit.contain),
        ),
        title: Text(items[selectedIndex].label),
        actions: const [_SearchButton(), _LanguageMenu(), _SignOutButton()],
      ),
      drawer: isWide
          ? null
          : _ModuleDrawer(items: items, current: widget.currentPath),
      body: isWide
          ? Row(
              children: [
                // A visible, explicitly scrollable navigation list keeps
                // every module reachable even on short screens in Arabic RTL.
                // Using a dedicated ScrollController avoids conflicting with
                // scrollable content inside the active screen.
                SizedBox(
                  width: isExtended ? 240 : 80,
                  child: Scrollbar(
                    controller: _navScrollController,
                    thumbVisibility: true,
                    child: ListView(
                      key: const Key('erp-shell-nav-list'),
                      controller: _navScrollController,
                      primary: false,
                      padding: const EdgeInsets.only(top: 8, bottom: 24),
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 18),
                          child: isExtended
                              ? Row(
                                  children: [
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(12),
                                      child: Image.asset(
                                        '1.png',
                                        width: 42,
                                        height: 42,
                                        fit: BoxFit.contain,
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                        'KAYAN ERP',
                                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                          fontWeight: FontWeight.w800,
                                          letterSpacing: 0.4,
                                        ),
                                      ),
                                    ),
                                  ],
                                )
                              : Tooltip(
                                  message: 'KAYAN ERP',
                                  child: Image.asset('1.png', width: 42, height: 42),
                                ),
                        ),
                        const Divider(height: 1),
                        const SizedBox(height: 8),
                        for (final item in items)
                          isExtended
                              ? ListTile(
                                  leading: Icon(item.icon),
                                  title: Text(item.label),
                                  selected: item.path == widget.currentPath,
                                  onTap: () => context.go(item.path),
                                )
                              : Tooltip(
                                  message: item.label,
                                  child: IconButton(
                                    onPressed: () => context.go(item.path),
                                    icon: Icon(item.icon),
                                    color: item.path == widget.currentPath
                                        ? Theme.of(context).colorScheme.primary
                                        : null,
                                  ),
                                ),
                      ],
                    ),
                  ),
                ),
                const VerticalDivider(width: 1),
                Expanded(child: widget.child),
              ],
            )
          : widget.child,
    );
  }

  List<_NavItem> _navigationItems(BuildContext context) {
    final l10n = context.l10n;
    return [
      _NavItem(AppRoutes.dashboard, Icons.dashboard_outlined, l10n.dashboard),
      _NavItem(AppRoutes.cash, Icons.account_balance_wallet_outlined, l10n.cashAndBanks),
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
      _NavItem(
        AppRoutes.companySettings,
        Icons.business_outlined,
        l10n.companySettings,
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
          padding: const EdgeInsets.only(top: 8, bottom: 24),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.asset('1.png', width: 48, height: 48, fit: BoxFit.contain),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    'KAYAN ERP',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.4,
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            const SizedBox(height: 8),
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

/// Opens the one search box that reaches every module.
class _SearchButton extends StatelessWidget {
  const _SearchButton();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return IconButton(
      tooltip: l10n.search,
      onPressed: () => showGlobalSearchDialog(context),
      icon: const Icon(Icons.search_rounded),
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
