import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show ScrollCacheExtent;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/notifications/presentation/screens/notification_center_screen.dart';
import '../../features/licensing/presentation/widgets/licence_gate.dart';
import '../../features/search/presentation/search_dialog.dart';
import '../../features/settings/presentation/providers/locale_provider.dart';
import '../../shared/extensions/l10n_extension.dart';
import '../../shared/widgets/kayan_logo.dart';
import '../../shared/widgets/user_avatar.dart';
import '../../features/admin/presentation/widgets/user_photo_dialog.dart';
import '../theme/section_theme.dart';
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
    this.accentOverride,
  });

  final String path;
  final IconData icon;
  final String label;
  final List<String>? permissions;
  final _NavGroup group;

  /// A section colour of its own when the entry is a daily destination in
  /// its own right (banks & cashboxes, inside the accounting group).
  final SectionAccent? accentOverride;

  SectionAccent get accent => accentOverride ?? _accentForGroup(group);

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

/// Each section owns one colour (see [SectionAccents]): the selected entry
/// is recognisable by its text, icon tile, background and edge indicator
/// all switching to it, and the top bar repeats it — so where you are is
/// visible before you read a word.
SectionAccent _accentForGroup(_NavGroup group) => switch (group) {
  _NavGroup.overview => SectionAccents.overview,
  _NavGroup.accounting => SectionAccents.accounting,
  // The group heading is the customers' colour; each entry carries its own
  // (turquoise for a customer, violet for a supplier) as an override.
  _NavGroup.parties => SectionAccents.customers,
  _NavGroup.inventory => SectionAccents.inventory,
  _NavGroup.sales => SectionAccents.sales,
  _NavGroup.purchases => SectionAccents.purchases,
  _NavGroup.insights => SectionAccents.insights,
  _NavGroup.administration => SectionAccents.administration,
};

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
  const ErpShell({
    super.key,
    required this.currentPath,
    this.child,
    this.navigationShell,
  });

  final String currentPath;

  /// The screen, when the shell is used directly (a test, or a screen that
  /// wants the frame without the router).
  final Widget? child;

  /// The router's branch container. Present in the real app: navigating
  /// switches the visible branch without rebuilding this shell.
  final StatefulNavigationShell? navigationShell;

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
      backgroundColor: items[selectedIndex].accent.pageOf(
        Theme.of(context).brightness,
      ),
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
                    item: items[selectedIndex],
                    sectionLabel: _Sidebar._groupLabel(
                      items[selectedIndex].group,
                      Localizations.localeOf(context).languageCode == 'ar',
                    ),
                    isWide: isWide,
                    isExtended: isExtended,
                  ),
                  Expanded(
                    child: SectionTheme(
                      accent: items[selectedIndex].accent,
                      child: SectionCanvas(
                        child: LicenceGate(
                          currentPath: widget.currentPath,
                          child:
                              widget.navigationShell ??
                              widget.child ??
                              const SizedBox.shrink(),
                        ),
                      ),
                    ),
                  ),
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
        // Banks & cashboxes are their own section in daily use, with their
        // own teal, even though they sit under the accounting heading.
        accentOverride: SectionAccents.cash,
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
        AppRoutes.fixedAssets,
        Icons.precision_manufacturing_outlined,
        l10n.fixedAssets,
        permissions: const ['accounting.fixedassets.read'],
        group: _NavGroup.accounting,
      ),
      _NavItem(
        AppRoutes.openingBalances,
        Icons.tune_outlined,
        l10n.openingBalancesTitle,
        // Seeing the figures needs the read grant; changing them needs manage.
        permissions: const [
          'accounting.openingbalances.read',
          'accounting.openingbalances.manage',
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
        accentOverride: SectionAccents.customers,
      ),
      _NavItem(
        AppRoutes.suppliers,
        Icons.local_shipping_outlined,
        l10n.suppliers,
        permissions: const ['parties.suppliers.read'],
        group: _NavGroup.parties,
        accentOverride: SectionAccents.suppliers,
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
        AppRoutes.warehouses,
        Icons.warehouse_outlined,
        // Written here rather than regenerating the catalogue for one screen,
        // the same way the stock-documents label is.
        Localizations.localeOf(context).languageCode == 'ar'
            ? 'إدارة المخازن'
            : 'Warehouses',
        permissions: const ['inventory.warehouses.read'],
        group: _NavGroup.inventory,
      ),
      _NavItem(
        AppRoutes.batches,
        Icons.qr_code_2_rounded,
        // Written here rather than regenerating the catalogue for one screen,
        // the same way the warehouse label is.
        Localizations.localeOf(context).languageCode == 'ar'
            ? 'الدفعات والصلاحية'
            : 'Lots & expiry',
        permissions: const ['inventory.batches.read'],
        group: _NavGroup.inventory,
      ),
      _NavItem(
        AppRoutes.stockDocuments,
        Icons.assignment_outlined,
        // No catalogue key yet: the label is written where it is used rather
        // than regenerating the localisations for one screen.
        Localizations.localeOf(context).languageCode == 'ar'
            ? 'المستندات المخزنية'
            : 'Stock documents',
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

    // The rail is a fixed icon column; the open sidebar gives a larger label
    // a wider column too, so "المحاسبة" is not squeezed into two narrow lines
    // at the largest text size. It grows by a little over half of the text
    // increase, which keeps the working area for the tables.
    final scale = MediaQuery.textScalerOf(context).scale(1);
    final width = extended
        ? AppSizes.sidebarWidth * (1 + (scale - 1) * 0.55)
        : AppSizes.sidebarRailWidth;

    return Container(
      width: width,
      // The program's frame: a navy column in both themes, deepening from
      // its lit top to its base. The sections' own colours ride on it as
      // lit tiles and edge marks — structure from the navy, identity from
      // the accent — while the work surfaces beside it stay white.
      decoration: const BoxDecoration(gradient: AppGradients.sidebar),
      child: Column(
        children: [
          _SidebarBrand(extended: extended),
          Container(height: 1, color: AppColors.sidebarHairline),
          Expanded(
            child: Scrollbar(
              controller: scrollController,
              thumbVisibility: true,
              thickness: 6,
              child: ListView(
                // A PageStorageKey, not a plain Key: a scroll view restores
                // its offset from page storage only when it can identify
                // itself, and this is the second guarantee (after the
                // controller that now outlives navigation) that the menu stays
                // where the person left it.
                key: const PageStorageKey<String>('erp-shell-nav-list'),
                controller: scrollController,
                primary: false,
                // Taps on the menu must not steal focus from the list and
                // scroll it into view.
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.manual,
                // All items stay built and painted a long way past the
                // viewport: permission tests and keyboard users must be able to
                // reach a module without scrolling first, and a scrollbar that
                // is dragged quickly must not show blank rows.
                scrollCacheExtent: const ScrollCacheExtent.pixels(4000),
                padding: EdgeInsets.fromLTRB(
                  extended ? 10 : 8,
                  10,
                  extended ? 10 : 8,
                  16,
                ),
                children: [
                  for (final group in _NavGroup.values)
                    if (groups[group]?.isNotEmpty ?? false)
                      _NavigationGroup(
                        label: _groupLabel(group, arabic),
                        items: groups[group]!,
                        current: current,
                        extended: extended,
                        first: group == _NavGroup.values.first,
                      ),
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

    // The owner's artwork, shown as it is: no white plate, no square crop.
    // The lockup is 3.13 : 1, so it is sized by height and allowed its own
    // width. In the narrow rail it is the whole lockup at a smaller height
    // rather than a cropped fragment - the mark and the word are one drawing
    // and cutting it in half is a different logo.
    if (!extended) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Tooltip(message: 'KAYAN ERP', child: KayanLogo(height: 18)),
      );
    }
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(16, 16, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const KayanLogo(height: 30),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'ERP SUITE',
            style: theme.textTheme.labelSmall?.copyWith(
              color: AppColors.onSidebarMuted,
              letterSpacing: 2.0,
              fontSize: 9,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// A collapsible navigation group. The same accent is used by the
/// sidebar group surface and by SectionCanvas on every screen in the group.
class _NavigationGroup extends StatefulWidget {
  const _NavigationGroup({
    required this.label,
    required this.items,
    required this.current,
    required this.extended,
    required this.first,
  });

  final String label;
  final List<_NavItem> items;
  final String current;
  final bool extended;
  final bool first;

  @override
  State<_NavigationGroup> createState() => _NavigationGroupState();
}

class _NavigationGroupState extends State<_NavigationGroup> {
  late bool _expanded;

  bool get _containsCurrent =>
      widget.items.any((item) => _belongsTo(item.path, widget.current));

  @override
  void initState() {
    super.initState();
    _expanded = true;
  }

  @override
  void didUpdateWidget(covariant _NavigationGroup oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.current != oldWidget.current && _containsCurrent) {
      _expanded = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final accent = _accentForGroup(widget.items.first.group);
    if (!widget.extended) {
      return Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(10, widget.first ? 4 : 12, 10, 6),
            child: Container(height: 1, color: AppColors.sidebarHairline),
          ),
          for (final item in widget.items)
            _NavEntry(
              item: item,
              selected: _belongsTo(item.path, widget.current),
              extended: false,
            ),
        ],
      );
    }

    return Padding(
      padding: EdgeInsets.only(top: widget.first ? 0 : 8, bottom: 4),
      child: Column(
        children: [
          Material(
            color: accent.darkBase.withValues(alpha: 0.16),
            borderRadius: BorderRadius.circular(AppRadii.md),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => setState(() => _expanded = !_expanded),
              child: Padding(
                padding: const EdgeInsetsDirectional.fromSTEB(10, 10, 8, 10),
                child: Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: accent.darkBase,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        widget.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.onSidebar,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    Icon(
                      _expanded
                          ? Icons.keyboard_arrow_up_rounded
                          : Icons.keyboard_arrow_down_rounded,
                      color: accent.darkBase,
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_expanded)
            Container(
              margin: const EdgeInsets.only(top: 4),
              padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 4),
              decoration: BoxDecoration(
                color: accent.darkBase.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(AppRadii.md),
              ),
              child: Column(
                children: [
                  for (final item in widget.items)
                    _NavEntry(
                      item: item,
                      selected: _belongsTo(item.path, widget.current),
                      extended: true,
                    ),
                ],
              ),
            ),
        ],
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
    final accent = item.accent;
    // The sidebar is navy in both themes, so every accent is read in its
    // brighter, dark-surface step here.
    final accentColor = accent.darkBase;

    // Every entry wears its section colour in a small icon tile, selected
    // or not; selecting it fills the tile, washes the row, colours the
    // label, and draws the edge indicator — four signals, one hue.
    Widget iconTile(double size, double iconSize) => Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: selected
            ? accentColor
            : Colors.white.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadii.md),
        boxShadow: selected
            ? [
                BoxShadow(
                  color: accentColor.withValues(alpha: 0.45),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ]
            : null,
      ),
      child: Icon(
        item.icon,
        size: iconSize,
        color: selected ? Colors.white : accentColor,
      ),
    );

    if (!extended) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Tooltip(
          message: item.label,
          child: Material(
            color: selected
                ? Colors.white.withValues(alpha: 0.10)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadii.md),
            clipBehavior: Clip.antiAlias,
            child: Container(
              decoration: BoxDecoration(
                border: BorderDirectional(
                  start: BorderSide(
                    color: selected ? accentColor : Colors.transparent,
                    width: 3,
                  ),
                ),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(AppRadii.md),
                hoverColor: Colors.white.withValues(alpha: 0.06),
                onTap: () => context.go(item.path),
                child: SizedBox(
                  height: 44,
                  child: Center(child: iconTile(32, 18)),
                ),
              ),
            ),
          ),
        ),
      );
    }

    // The selected background lives on a Material, not on a coloured box:
    // ListTile paints its ink on the nearest Material ancestor, and a box
    // colour in between would hide the splash. The accent is drawn as a
    // start-side border, which is direction-aware and keeps the full height.
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Material(
        color: selected
            ? Colors.white.withValues(alpha: 0.10)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadii.md),
        clipBehavior: Clip.antiAlias,
        child: Container(
          decoration: BoxDecoration(
            border: BorderDirectional(
              start: BorderSide(
                color: selected ? accentColor : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          child: ListTile(
            dense: true,
            visualDensity: const VisualDensity(vertical: -1, horizontal: -1),
            selected: selected,
            selectedTileColor: Colors.transparent,
            hoverColor: Colors.white.withValues(alpha: 0.06),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadii.md),
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 8,
              vertical: 2,
            ),
            minLeadingWidth: 30,
            horizontalTitleGap: 10,
            leading: iconTile(30, 17),
            title: Text(
              item.label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: selected ? accentColor : AppColors.onSidebar,
                fontSize: 13,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
            onTap: () => context.go(item.path),
          ),
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
        border: Border(top: BorderSide(color: AppColors.sidebarHairline)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          // The same face as the top bar: the account's photo when it has
          // one, the initial otherwise. `initials` is kept for the tooltip so
          // the rail's meaning does not change.
          Tooltip(
            message: initials,
            child: UserAvatar(
              userId: user.id,
              name: user.fullName.isEmpty ? user.username : user.fullName,
              hasPhoto: user.hasAvatar,
              size: 30,
              ring: true,
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
                    color: AppColors.onSidebar,
                    fontWeight: FontWeight.w600,
                    fontSize: 11.5,
                  ),
                ),
                Text(
                  role.toLowerCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: AppColors.onSidebarMuted,
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
    required this.item,
    required this.sectionLabel,
    required this.isWide,
    required this.isExtended,
  });

  final _NavItem item;
  final String sectionLabel;
  final bool isWide;
  final bool isExtended;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final accentColor = item.accent.of(scheme.brightness);
    return Container(
      height: Theme.of(context).appBarTheme.toolbarHeight ??
          AppSizes.topBarHeight,
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(bottom: BorderSide(color: scheme.outlineVariant)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A000000),
            blurRadius: 6,
            offset: Offset(0, 1),
          ),
        ],
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
          // The current section, in its own colour: icon tile + section
          // name over the page title, so the bar answers «أين أنا؟»
          // before the title is read.
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: item.accent.softOf(scheme.brightness),
              borderRadius: BorderRadius.circular(AppRadii.md),
            ),
            child: Icon(item.icon, size: 19, color: accentColor),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        sectionLabel,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: accentColor,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.6,
                        ),
                      ),
                      Text(
                        item.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium?.copyWith(
                          color: scheme.onSurface,
                          fontWeight: FontWeight.w700,
                          height: 1.15,
                        ),
                      ),
                    ],
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
          IconButton(
            tooltip: context.l10n.dashboard,
            onPressed: () => context.go(AppRoutes.dashboard),
            icon: const Icon(Icons.home_outlined, size: 19),
          ),
          const SizedBox(width: AppSpacing.xs),
          _SearchTrigger(expanded: isExtended),
          const SizedBox(width: AppSpacing.xs),
          // Before the language menu: an unread alert is more urgent than a
          // translation, and the two must not be confused for each other.
          const NotificationBell(),
          const SizedBox(width: AppSpacing.xxs),
          const _LanguageMenu(),
          const SizedBox(width: AppSpacing.xxs),
          const _AccountMenu(),
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

/// The signed-in person, in the top bar, with their own face.
///
/// The photo is the account's, not the machine's: it comes from
/// `/users/:id/avatar`, so signing in on another computer shows the same
/// picture. Without one, the initial letter is drawn - never a generic
/// silhouette, which at this size reads as a broken image.
///
/// The menu is also the only place the person can change their own photo
/// without being an administrator: changing *your* picture is not a
/// privileged act, changing somebody else's is.
class _AccountMenu extends ConsumerWidget {
  const _AccountMenu();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final user = ref.watch(currentUserProvider);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    if (user == null) return const SizedBox.shrink();

    final name = user.fullName.isEmpty ? user.username : user.fullName;

    return PopupMenuButton<String>(
      tooltip: name,
      offset: const Offset(0, 44),
      onSelected: (value) async {
        if (value == 'photo') {
          await showUserPhotoDialog(
            context,
            userId: user.id,
            userName: name,
            hasPhoto: user.hasAvatar,
            isSelf: true,
          );
        }
      },
      itemBuilder: (context) => [
        PopupMenuItem<String>(
          enabled: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(name, style: theme.textTheme.titleSmall),
              Text(
                user.username,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        const PopupMenuDivider(),
        PopupMenuItem<String>(
          value: 'photo',
          child: Row(
            children: [
              const Icon(Icons.photo_camera_outlined, size: 18),
              const SizedBox(width: AppSpacing.sm),
              Text(arabic ? 'صورتي' : 'My photo'),
            ],
          ),
        ),
      ],
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            UserAvatar(
              userId: user.id,
              name: name,
              hasPhoto: user.hasAvatar,
              size: 30,
            ),
            if (MediaQuery.sizeOf(context).width >= 1280) ...[
              const SizedBox(width: AppSpacing.sm),
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const Icon(Icons.arrow_drop_down, size: 18),
          ],
        ),
      ),
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
            Container(height: 1, color: AppColors.sidebarHairline),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 20),
                children: [
                  for (final group in _NavGroup.values)
                    if (groups[group]?.isNotEmpty ?? false)
                      _NavigationGroup(
                        label: _Sidebar._groupLabel(group, arabic),
                        items: groups[group]!,
                        current: current,
                        extended: true,
                        first: group == _NavGroup.values.first,
                      ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
