import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../features/auth/domain/entities/app_user.dart';
import '../../../../l10n/generated/app_localizations.dart';

typedef _Shortcut = ({String path, String label, String permission});

class _Module {
  const _Module(this.key, this.title, this.icon, this.color, this.shortcuts);
  final String key;
  final String title;
  final IconData icon;
  final Color color;
  final List<_Shortcut> shortcuts;
}

/// Six large destinations on the home screen. Every displayed link is checked
/// against the same read permission used by the sidebar and API route.
class CommandCenter extends StatelessWidget {
  const CommandCenter({super.key, required this.user, required this.arabic, required this.l10n});

  final AppUser? user;
  final bool arabic;
  final AppLocalizations l10n;

  List<_Module> _modules() => [
    _Module('sales', arabic ? 'المبيعات' : 'Sales', Icons.point_of_sale_rounded,
      const Color(0xFF2259CF), [
        (path: AppRoutes.salesInvoices, label: l10n.salesInvoices, permission: 'sales.invoices.read'),
        (path: AppRoutes.salesOrders, label: arabic ? 'أوامر البيع' : 'Sales orders', permission: 'sales.orders.read'),
        (path: AppRoutes.salesReturns, label: l10n.salesReturns, permission: 'sales.returns.read|sales.invoices.read|sales.invoices.create'),
      ]),
    _Module('purchases', arabic ? 'المشتريات' : 'Purchases', Icons.shopping_cart_rounded,
      const Color(0xFFCC6417), [
        (path: AppRoutes.purchaseInvoices, label: l10n.purchaseInvoices, permission: 'purchases.invoices.read'),
        (path: AppRoutes.purchaseOrders, label: arabic ? 'أوامر الشراء' : 'Purchase orders', permission: 'purchases.orders.read'),
        (path: AppRoutes.purchaseReturns, label: l10n.purchaseReturns, permission: 'purchases.returns.read|purchases.invoices.read|purchases.invoices.create'),
      ]),
    _Module('inventory', arabic ? 'المخازن' : 'Inventory', Icons.inventory_2_rounded,
      const Color(0xFF218653), [
        (path: AppRoutes.stock, label: l10n.stock, permission: 'inventory.stock.read'),
        (path: AppRoutes.items, label: l10n.items, permission: 'inventory.items.read'),
        (path: AppRoutes.warehouses, label: arabic ? 'المستودعات' : 'Warehouses', permission: 'inventory.warehouses.read'),
      ]),
    _Module('accounting', arabic ? 'الحسابات' : 'Accounting', Icons.account_balance_rounded,
      const Color(0xFF7052B7), [
        (path: AppRoutes.chartOfAccounts, label: l10n.chartOfAccounts, permission: 'accounting.accounts.read'),
        (path: AppRoutes.journalEntries, label: l10n.journalEntries, permission: 'accounting.journal.read'),
        (path: AppRoutes.cash, label: l10n.cashAndBanks, permission: 'cash.accounts.read|cash.vouchers.read|cash.reports.read'),
      ]),
    _Module('customers', l10n.customers, Icons.groups_rounded,
      const Color(0xFFA34593), [
        (path: AppRoutes.customers, label: l10n.customers, permission: 'parties.customers.read'),
      ]),
    _Module('suppliers', l10n.suppliers, Icons.local_shipping_rounded,
      const Color(0xFFBB3F48), [
        (path: AppRoutes.suppliers, label: l10n.suppliers, permission: 'parties.suppliers.read'),
      ]),
  ];

  @override
  Widget build(BuildContext context) {
    final principal = user;
    if (principal == null) return const SizedBox.shrink();
    bool allowed(_Shortcut shortcut) => shortcut.permission.split('|').any(principal.can);
    final modules = [
      for (final module in _modules())
        if (module.shortcuts.any(allowed))
          (module: module, links: module.shortcuts.where(allowed).toList()),
    ];
    if (modules.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(arabic ? 'مركز العمليات' : 'Command center',
        style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
      const SizedBox(height: AppSpacing.md),
      LayoutBuilder(builder: (context, constraints) {
        final columns = constraints.maxWidth >= 930 ? 3 : constraints.maxWidth >= 590 ? 2 : 1;
        final cardWidth = (constraints.maxWidth - (columns - 1) * AppSpacing.md) / columns;
        return Wrap(spacing: AppSpacing.md, runSpacing: AppSpacing.md, children: [
          for (final entry in modules)
            SizedBox(width: cardWidth, height: 264,
              child: _ModuleTile(module: entry.module, links: entry.links)),
        ]);
      }),
    ]);
  }
}

class _ModuleTile extends StatelessWidget {
  const _ModuleTile({required this.module, required this.links});
  final _Module module;
  final List<_Shortcut> links;

  @override
  Widget build(BuildContext context) {
    return Material(color: module.color, borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias, child: InkWell(
        key: ValueKey('command-${module.key}'),
        onTap: () => context.go(links.first.path),
        child: Padding(padding: const EdgeInsets.all(18), child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Container(width: 46, height: 46,
                decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.17),
                  borderRadius: BorderRadius.circular(13)),
                child: Icon(module.icon, color: Colors.white, size: 25)),
              const Spacer(),
              const Icon(Icons.arrow_outward_rounded, color: Colors.white70, size: 20),
            ]),
            const SizedBox(height: 12),
            Text(module.title, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: Colors.white, fontWeight: FontWeight.w800)),
            const Spacer(),
            Wrap(spacing: 6, runSpacing: 4, children: [
              for (final link in links)
                Material(
                  color: Colors.white.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(9),
                  child: InkWell(
                    key: ValueKey('command-link-${link.path}'),
                    borderRadius: BorderRadius.circular(9),
                    onTap: () => context.go(link.path),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
                      child: Text(link.label, maxLines: 1,
                        style: const TextStyle(fontSize: 11, color: Colors.white, fontWeight: FontWeight.w600)),
                    ),
                  ),
                ),
            ]),
          ],
        )),
      ));
  }
}
