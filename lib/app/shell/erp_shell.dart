import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/search/presentation/search_dialog.dart';
import '../../features/settings/presentation/providers/locale_provider.dart';
import '../../shared/extensions/l10n_extension.dart';
import '../router/app_router.dart';
import '../theme/design_tokens.dart';

/// One entry in the navigation.
///
/// [permissions] is the set of server permissions that open the module. A
/// module is shown when the account holds **any** of them, because a screen is
/// often usable by more than one job: the cash screen, for instance, is opened
/// by a cashier who only holds `cash.vouchers.read`, not by the accountant who
/// also holds `cash.accounts.read`. Keying the menu to a single permission
/// hid whole modules from people the server would have let in.
///
/// `null` means "no permission needed" (the settings screen, which every
/// signed-in person can use). The server remains the authority: this is a
/// courtesy, not the access rule.
class _NavItem {
  const _NavItem(
    this.path,
    this.icon,
    this.label, {
    this.permissions,
    this.group = _NavGroup.administration,
  });

  final String path;
  final IconData icon;
  final String label;
  final List<String>? permissions;
  final _NavGroup group;

  bool allows(bool Function(String) can) {
    final required = permissions;
    if (required == null || required.isEmpty) return true;
    return required.any(can);
  }
}

/// The menu is grouped by the job it belongs to, not alphabetically. Groups
/// with no visible item disappear entirely, so a cashier never sees an empty
/// "Accounting" heading.
enum _NavGroup { overview, accounting, parties, inventory, sales, purchases, insights, administration }

/// Adaptive chrome around every authenticated screen.
///
/// Breakpoints:
///  * < 900 px   — a drawer, because a bottom bar cannot hold a full ERP
///  * >= 900 px  — a permanent icon rail
///  * >= 1280 px — the rail widens and shows labels, grouped by module family
///
/// The navigation model itself changes with the available width; this is not
/// a phone layout stretched across a monitor.
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
    final selectedIndex = _selectedIndex(items);

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      drawer: isWide
          ? null
          : _ModuleDrawer(
              items: items,
              current: widget.currentPath,
            ),
      body: SafeArea(
        bottom: false,
        child: Row(
          children: [
            if (isWide)
              _Sidebar(
                items: items,
                current: widget.currentPath,
                extended: isExtended,
                scrollController: _navScrollController,
              ),
            Expanded(
              child: Column(
                children: [
                  _TopBar(
                    title: items[selectedIndex].label,
                    isWide: isWide,
                    isExtended: isExtended,
                  ),
                  Expanded(child: widget.child),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// The module a path belongs to. Editors live under their list route
  /// (`/sales/quotations/new`), so the longest matching prefix wins — a
  /// prefixed match is what keeps the header saying "Quotations" while the
  /// new-quotation form is open.
  int _selectedIndex(List<_NavItem> items) {
    var bestIndex = 0;
    var bestLength = -1;
    for (var index = 0; index < items.length; index += 1) {
      final path = items[index].path;
      final matches =
          widget.currentPath == path ||
          widget.currentPath.startsWith('$path/');
      if (matches && path.length > bestLength) {
        bestIndex = index;
        bestLength = path.length;
      }
    }
    return bestIndex;
  }

  List<_NavItem> _navigationItems(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final items = [
      _NavItem(
        AppRoutes.dashboard,
        Icons.space_dashboard_outlined,
        l10n.dashboard,
        group: _NavGroup.overview,
      ),
      _NavItem(
        AppRoutes.cash,
        Icons.account_balance_outlined,
        l10n.cashAndBanks,
        permissions: const [
          'cash.accounts.read',
          'cash.vouchers.read',
          'cash.reports.read',
        ],
        group: _NavGroup.accounting,
      ),
      _NavItem(
        AppRoutes.journalEntries,
        Icons.menu_book_outlined,
        l10n.journalEntries,
        permissions: const ['accounting.journal.read'],
        group: _NavGroup.accounting,
      ),
      _NavItem(
        AppRoutes.fiscalPeriods,
        Icons.event_available_outlined,
        l10n.fiscalPeriods,
        permissions: const ['accounting.periods.read'],
        group: _NavGroup.accounting,
      ),
      _NavItem(
        AppRoutes.openingBalances,
        Icons.tune_outlined,
        l10n.openingBalancesTitle,
        // Readable with the journal permission; changing them needs manage.
        permissions: const [
          'accounting.openingbalances.manage',
          'accounting.journal.read',
        ],
        group: _NavGroup.accounting,
      ),
      _NavItem(
        AppRoutes.chartOfAccounts,
        Icons.account_tree_outlined,
        l10n.chartOfAccounts,
        permissions: const ['accounting.accounts.read'],
        group: _NavGroup.accounting,
      ),
      // The cost-center dimension and its plans sit beside the chart of
      // accounts: they are accounting master data, not a settings screen.
      _NavItem(
        AppRoutes.costCenters,
        Icons.workspaces_outline,
        l10n.costCenters,
        permissions: const ['accounting.costcenters.read'],
        group: _NavGroup.accounting,
      ),
      _NavItem(
        AppRoutes.budgets,
        Icons.savings_outlined,
        l10n.budgets,
        permissions: const ['accounting.budgets.read'],
        group: _NavGroup.accounting,
      ),
      _NavItem(
        AppRoutes.customers,
        Icons.people_outline,
        l10n.customers,
        permissions: const ['parties.customers.read'],
        group: _NavGroup.parties,
      ),
      _NavItem(
        AppRoutes.suppliers,
        Icons.local_shipping_outlined,
        l10n.suppliers,
        permissions: const ['parties.suppliers.read'],
        group: _NavGroup.parties,
      ),
      _NavItem(
        AppRoutes.items,
        Icons.category_outlined,
        l10n.items,
        permissions: const ['inventory.items.read'],
        group: _NavGroup.inventory,
      ),
      _NavItem(
        AppRoutes.stock,
        Icons.inventory_2_outlined,
        l10n.stock,
        permissions: const ['inventory.stock.read'],
        group: _NavGroup.inventory,
      ),
      _NavItem(
        AppRoutes.salesInvoices,
        Icons.point_of_sale_outlined,
        l10n.salesInvoices,
        permissions: const ['sales.invoices.read'],
        group: _NavGroup.sales,
      ),
      _NavItem(
        AppRoutes.quotations,
        Icons.request_quote_outlined,
        l10n.quotations,
        permissions: const ['sales.quotations.read'],
        group: _NavGroup.sales,
      ),
      _NavItem(
        AppRoutes.salesReturns,
        Icons.assignment_return_outlined,
        l10n.salesReturns,
        // The returns API itself is guarded by the invoice permissions, so a
        // role that can use it must not lose the menu entry for lacking the
        // separately-seeded `sales.returns.read` grant.
        permissions: const [
          'sales.returns.read',
          'sales.invoices.read',
          'sales.invoices.create',
        ],
        group: _NavGroup.sales,
      ),
      _NavItem(
        AppRoutes.purchaseInvoices,
        Icons.shopping_cart_outlined,
        l10n.purchaseInvoices,
        permissions: const ['purchases.invoices.read'],
        group: _NavGroup.purchases,
      ),
      _NavItem(
        AppRoutes.purchaseReturns,
        Icons.keyboard_return_outlined,
        l10n.purchaseReturns,
        permissions: const [
          'purchases.returns.read',
          'purchases.invoices.read',
          'purchases.invoices.create',
        ],
        group: _NavGroup.purchases,
      ),
      _NavItem(
        AppRoutes.reports,
        Icons.bar_chart_outlined,
        l10n.reports,
        permissions: const ['reports.read'],
        group: _NavGroup.insights,
      ),
      // Import and the backup tools stay reachable for anyone signed in:
      // their own endpoints still check the resource they touch, and hiding
      // the import screen would strand the opening-balance review button
      // that links to it.
      _NavItem(
        AppRoutes.importData,
        Icons.upload_file_outlined,
        l10n.importData,
        group: _NavGroup.administration,
      ),
      _NavItem(
        AppRoutes.backup,
        Icons.verified_user_outlined,
        l10n.backupTitle,
        permissions: const ['admin.backup'],
        group: _NavGroup.administration,
      ),
      _NavItem(
        AppRoutes.administration,
        Icons.admin_panel_settings_outlined,
        l10n.administration,
        permissions: const ['admin.users.manage'],
        group: _NavGroup.administration,
      ),
      _NavItem(
        AppRoutes.companySettings,
        Icons.business_outlined,
        l10n.companySettings,
        permissions: const ['admin.company.manage'],
        group: _NavGroup.administration,
      ),
      _NavItem(
        AppRoutes.settings,
        Icons.settings_outlined,
        l10n.settings,
        group: _NavGroup.administration,
      ),
    ];
    // While the session is still being restored there is no user yet. The
    // router sends a signed-out visitor to the login screen, so the menu is
    // never actually seen in this state; showing everything keeps the previous
    // behaviour instead of flashing an empty rail.
    if (user == null) return items;
    return items
        .where((item) => item.allows(user.can))
        .toList(growable: false);
  }
}

/// Editors live under their list route (`/sales/quotations/new`), so the
/// parent entry stays highlighted while the form is open.
bool _belongsTo(String path, String current) =>
    current == path || current.startsWith('$path/');

/// The permanent navigation column.
class _Sidebar extends StatelessWidget {
  const _Sidebar({
    required this.items,
    required this.current,
    required this.extended,
    required this.scrollController,
  });

  final List<_NavItem> items;
  final String current;
  final bool extended;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final groups = <_NavGroup, List<_NavItem>>{};
    for (final item in items) {
      groups.putIfAbsent(item.group, () => []).add(item);
    }

    return Container(
      width: extended ? AppSizes.sidebarWidth : AppSizes.sidebarRailWidth,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [AppColors.navy, AppColors.navyDeep],
        ),
        border: BorderDirectional(
          end: BorderSide(color: Color(0x14FFFFFF)),
        ),
      ),
      child: Column(
        children: [
          _SidebarBrand(extended: extended),
          Container(height: 1, color: const Color(0x1FFFFFFF)),
          Expanded(
            child: Scrollbar(
              controller: scrollController,
              thumbVisibility: true,
              thickness: 6,
              child: ListView(
                key: const Key('erp-shell-nav-list'),
                controller: scrollController,
                primary: false,
                // All items stay built: permission tests and keyboard users
                // must be able to reach a module without scrolling first.
                cacheExtent: 4000,
                padding: EdgeInsets.fromLTRB(
                  extended ? 10 : 8,
                  10,
                  extended ? 10 : 8,
                  16,
                ),
                children: [
                  for (final group in _NavGroup.values)
                    if (groups[group]?.isNotEmpty ?? false) ...[
                      _GroupLabel(
                        extended: extended,
                        first: group == _NavGroup.values.first,
                        label: _groupLabel(group, arabic),
                      ),
                      for (final item in groups[group]!)
                        _NavEntry(
                          item: item,
                          selected: _belongsTo(item.path, current),
                          extended: extended,
                        ),
                    ],
                ],
              ),
            ),
          ),
          const _SidebarFooter(),
        ],
      ),
    );
  }

  static String _groupLabel(_NavGroup group, bool arabic) {
    return switch (group) {
      _NavGroup.overview => arabic ? 'نظرة عامة' : 'Overview',
      _NavGroup.accounting => arabic ? 'المحاسبة' : 'Accounting',
      _NavGroup.parties => arabic ? 'العملاء والموردون' : 'Parties',
      _NavGroup.inventory => arabic ? 'المخزون' : 'Inventory',
      _NavGroup.sales => arabic ? 'المبيعات' : 'Sales',
      _NavGroup.purchases => arabic ? 'المشتريات' : 'Purchasing',
      _NavGroup.insights => arabic ? 'التحليل' : 'Insights',
      _NavGroup.administration => arabic ? 'الإدارة والبيانات' : 'Administration',
    };
  }
}

class _SidebarBrand extends StatelessWidget {
  const _SidebarBrand({required this.extended});

  final bool extended;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final logo = Container(
      width: 34,
      height: 34,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: Image.asset('1.png', fit: BoxFit.contain),
    );
    if (!extended) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Tooltip(message: 'KAYAN ERP', child: logo),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Row(
        children: [
          logo,
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'KAYAN',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.6,
                    fontSize: 15,
                  ),
                ),
                Text(
                  'ERP SUITE',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: AppColors.onNavyMuted,
                    letterSpacing: 2.0,
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _GroupLabel extends StatelessWidget {
  const _GroupLabel({
    required this.extended,
    required this.first,
    required this.label,
  });

  final bool extended;
  final bool first;
  final String label;

  @override
  Widget build(BuildContext context) {
    if (!extended) {
      return Padding(
        padding: EdgeInsets.fromLTRB(10, first ? 4 : 12, 10, 6),
        child: Container(height: 1, color: const Color(0x1FFFFFFF)),
      );
    }
    return Padding(
      padding: EdgeInsets.fromLTRB(8, first ? 4 : 14, 8, 5),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: Color(0xFF7E93AD),
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class _NavEntry extends StatelessWidget {
  const _NavEntry({
    required this.item,
    required this.selected,
    required this.extended,
  });

  final _NavItem item;
  final bool selected;
  final bool extended;

  @override
  Widget build(BuildContext context) {
    final foreground = selected ? Colors.white : AppColors.onNavyMuted;

    if (!extended) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Tooltip(
          message: item.label,
          child: Material(
            color: selected ? const Color(0x1FFFFFFF) : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadii.md),
            child: InkWell(
              borderRadius: BorderRadius.circular(AppRadii.md),
              onTap: () => context.go(item.path),
              child: SizedBox(
                height: 40,
                child: Center(
                  child: Icon(item.icon, size: 19, color: foreground),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Container(
        decoration: BoxDecoration(
          color: selected ? const Color(0x1FFFFFFF) : Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadii.md),
          border: BorderDirectional(
            start: BorderSide(
              color: selected ? AppColors.accent : Colors.transparent,
              width: 2.5,
            ),
          ),
        ),
        child: ListTile(
          dense: true,
          visualDensity: const VisualDensity(vertical: -2, horizontal: -1),
          selected: selected,
          selectedTileColor: Colors.transparent,
          hoverColor: const Color(0x0FFFFFFF),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadii.md),
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 9),
          minLeadingWidth: 18,
          horizontalTitleGap: 10,
          leading: Icon(item.icon, size: 18, color: foreground),
          title: Text(
            item.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: foreground,
              fontSize: 12.5,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
          onTap: () => context.go(item.path),
        ),
      ),
    );
  }
}

class _SidebarFooter extends ConsumerWidget {
  const _SidebarFooter();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    if (user == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final initials = _initials(user.fullName, user.username);
    final role = user.roles.isEmpty ? user.username : user.roles.first;
    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Color(0x1FFFFFFF))),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0x24FFFFFF),
              borderRadius: BorderRadius.circular(AppRadii.sm),
            ),
            child: Text(
              initials,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  user.fullName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: 11.5,
                  ),
                ),
                Text(
                  role.toLowerCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: AppColors.onNavyMuted,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _initials(String fullName, String username) {
    final source = fullName.trim().isEmpty ? username.trim() : fullName.trim();
    if (source.isEmpty) return '?';
    final parts =
        source.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    String head(String value) =>
        value.isEmpty ? '' : value.substring(0, 1).toUpperCase();
    if (parts.length >= 2) return head(parts.first) + head(parts[1]);
    final text = parts.first;
    return text.substring(0, text.length >= 2 ? 2 : 1).toUpperCase();
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.title,
    required this.isWide,
    required this.isExtended,
  });

  final String title;
  final bool isWide;
  final bool isExtended;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Container(
      height: AppSizes.topBarHeight,
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(
          bottom: BorderSide(
            color: scheme.brightness == Brightness.light
                ? AppColors.border
                : AppColors.darkBorder,
          ),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Row(
        children: [
          if (!isWide) ...[
            Builder(
              builder: (context) => IconButton(
                tooltip: MaterialLocalizations.of(context).openAppDrawerTooltip,
                onPressed: () => Scaffold.of(context).openDrawer(),
                icon: const Icon(Icons.menu_rounded),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
          ],
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleMedium?.copyWith(
                      color: scheme.onSurface,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (isExtended) ...[
                  const SizedBox(width: AppSpacing.md),
                  Container(width: 1, height: 14, color: scheme.outlineVariant),
                  const SizedBox(width: AppSpacing.md),
                  Flexible(
                    child: Text(
                      'KAYAN ERP',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                        letterSpacing: 1.1,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          _SearchTrigger(expanded: isExtended),
          const SizedBox(width: AppSpacing.xs),
          const _LanguageMenu(),
          const SizedBox(width: AppSpacing.xxs),
          const _SignOutButton(),
        ],
      ),
    );
  }
}

/// Opens the one search box that reaches every module.
class _SearchTrigger extends StatelessWidget {
  const _SearchTrigger({required this.expanded});

  final bool expanded;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final label = context.l10n.search;

    return Tooltip(
      message: label,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadii.md),
          onTap: () => showGlobalSearchDialog(context),
          child: Container(
            height: 32,
            padding: EdgeInsets.symmetric(horizontal: expanded ? 10 : 7),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(AppRadii.md),
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.search_rounded,
                  size: 16,
                  color: scheme.onSurfaceVariant,
                ),
                if (expanded) ...[
                  const SizedBox(width: 6),
                  Text(
                    label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
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
      icon: const Icon(Icons.translate_rounded, size: 19),
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
      icon: const Icon(Icons.logout_rounded, size: 19),
      tooltip: context.l10n.signOut,
      onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
    );
  }
}

/// The navigation for narrow windows: the same items, the same permissions,
/// the same order — inside the standard drawer.
class _ModuleDrawer extends StatelessWidget {
  const _ModuleDrawer({required this.items, required this.current});

  final List<_NavItem> items;
  final String current;

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final groups = <_NavGroup, List<_NavItem>>{};
    for (final item in items) {
      groups.putIfAbsent(item.group, () => []).add(item);
    }
    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            const Padding(
              padding: EdgeInsets.only(top: 6, bottom: 6),
              child: _SidebarBrand(extended: true),
            ),
            Container(height: 1, color: const Color(0x1FFFFFFF)),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 20),
                children: [
                  for (final group in _NavGroup.values)
                    if (groups[group]?.isNotEmpty ?? false) ...[
                      _GroupLabel(
                        extended: true,
                        first: group == _NavGroup.values.first,
                        label: _Sidebar._groupLabel(group, arabic),
                      ),
                      for (final item in groups[group]!)
                        _NavEntry(
                          item: item,
                          selected: _belongsTo(item.path, current),
                          extended: true,
                        ),
                    ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
