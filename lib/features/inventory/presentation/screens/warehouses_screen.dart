import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/data_dialog.dart';
import '../widgets/warehouse_balance_dialog.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Where goods are kept: the warehouses of the company, one row each.
///
/// The list is narrowed by the server to the branches the caller is assigned
/// to, so this screen never has to decide what a person may see. A warehouse
/// is never deleted - documents name it forever - it is switched off and can be
/// switched back on, which is why the row action is a toggle and not a delete.
///
/// Reading needs `inventory.warehouses.read`, changing needs
/// `inventory.warehouses.manage`; both are checked again on the server.
class WarehousesController extends JsonListController {
  @override
  String get resourcePath => '/inventory/warehouses';

  /// Inactive warehouses are listed too: a screen that hid them would make a
  /// switched-off warehouse impossible to switch back on.
  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

/// Shared by this screen and by every picker that has to name a warehouse.
final warehousesListProvider =
    AsyncNotifierProvider<WarehousesController, List<Json>>(
      WarehousesController.new,
    );

class WarehousesScreen extends ConsumerStatefulWidget {
  const WarehousesScreen({super.key});

  @override
  ConsumerState<WarehousesScreen> createState() => _WarehousesScreenState();
}

class _WarehousesScreenState extends ConsumerState<WarehousesScreen> {
  String _query = '';
  bool _busy = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  /// The backend carries both names; the screen shows the one belonging to the
  /// interface language, in the same way items and stock already do.
  String _name(Json row) =>
      _arabic ? text(row, 'nameAr') : text(row, 'nameEn');

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(warehousesListProvider);
    // The menu already hides the entry without the read grant; the buttons
    // need the manage grant, exactly like budgets and cost centres.
    final canManage =
        ref.watch(currentUserProvider)?.can('inventory.warehouses.manage') ??
        false;

    return ModuleScaffold(
      title: _arabic ? 'المستودعات' : 'Warehouses',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      // MainAxisSize.min and a flexible search keep this toolbar inside the
      // header's Flexible: a plain Row there overflowed once a third button
      // joined it. A Flexible inside that Row did not help either - the AppBar
      // hands its actions an unbounded width, so the search box was squeezed to
      // zero. A Wrap lets each action take the width it asks for and moves the
      // rest onto a second line when the window is narrow.
      trailing: Wrap(
        spacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          IconButton(
            tooltip: _arabic ? 'تحديث' : 'Refresh',
            onPressed: () => ref.read(warehousesListProvider.notifier).reload(),
            icon: const Icon(Icons.refresh),
          ),
          SearchField(
            hint: _arabic ? 'بحث في المستودعات' : 'Search warehouses',
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
          // Reading what is on the shelves is a read grant, not a manage one:
          // the same person who may look at a warehouse may look inside it.
          // This opens the default warehouse, which is the one the rest of the
          // screen treats as current; a specific shelf is reachable from its
          // own row action. Taking the first visible row opened whichever
          // warehouse happened to sort first, which is not the default one as
          // soon as the operator sorts or filters the table.
          OutlinedButton.icon(
            onPressed: () {
              final rows = _filter(async.value ?? const <Json>[]);
              if (rows.isEmpty) return;
              final preferred = rows.firstWhere(
                (row) => flag(row, 'isDefault'),
                orElse: () => rows.first,
              );
              _openBalances(preferred);
            },
            icon: const Icon(Icons.inventory_2_outlined, size: 18),
            label: Text(_arabic ? 'الأرصدة' : 'Balances'),
          ),
          if (canManage)
            FilledButton.icon(
              onPressed: _busy ? null : () => _save(),
              icon: const Icon(Icons.add),
              label: Text(_arabic ? 'مستودع جديد' : 'New warehouse'),
            ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(warehousesListProvider.notifier).reload(),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: _arabic
            ? 'لا توجد مستودعات بعد.'
            : 'No warehouses yet.',
        data: (rows) => RecordsTable(
          rows: _filter(rows),
          columns: [
            ColumnSpec(
              l10n.warehouse,
              value: (r) => _name(r),
              emphasise: true,
            ),
            ColumnSpec(
              _arabic ? 'الكود' : 'Code',
              value: (r) => text(r, 'code'),
            ),
            ColumnSpec(
              _arabic ? 'الفرع' : 'Branch',
              value: (r) => _arabic
                  ? text(r, 'branchNameAr')
                  : text(r, 'branchNameEn'),
            ),
            ColumnSpec(
              _arabic ? 'العنوان' : 'Address',
              value: (r) => text(r, 'address'),
            ),
            ColumnSpec(
              _arabic ? 'افتراضي' : 'Default',
              value: (r) => flag(r, 'isDefault')
                  ? (_arabic ? 'نعم' : 'Yes')
                  : (_arabic ? 'لا' : 'No'),
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => flag(r, 'isActive', fallback: true)
                  ? l10n.active
                  : l10n.inactive,
              tone: (r) => flag(r, 'isActive', fallback: true)
                  ? AppTone.success
                  : AppTone.neutral,
            ),
          ],
          actions: (row) => [
            IconButton(
              tooltip: _arabic ? 'أرصدة المستودع' : 'Warehouse balances',
              icon: const Icon(Icons.account_balance_wallet_outlined, size: 20),
              onPressed: () => _openBalances(row),
            ),
            if (canManage) ...[
              IconButton(
                tooltip: l10n.edit,
                icon: const Icon(Icons.edit_outlined, size: 20),
                onPressed: _busy ? null : () => _save(existing: row),
              ),
              IconButton(
                tooltip: flag(row, 'isActive', fallback: true)
                    ? l10n.deactivate
                    : l10n.activate,
                icon: Icon(
                  flag(row, 'isActive', fallback: true)
                      ? Icons.block_outlined
                      : Icons.check_circle_outline,
                  size: 20,
                ),
                onPressed: _busy ? null : () => _toggleActive(row),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<Json> _filter(List<Json> rows) {
    if (_query.isEmpty) return rows;
    final needle = _query.toLowerCase();
    return rows
        .where(
          (r) =>
              text(r, 'code').toLowerCase().contains(needle) ||
              text(r, 'nameEn').toLowerCase().contains(needle) ||
              text(r, 'nameAr').contains(_query) ||
              text(r, 'address').toLowerCase().contains(needle),
        )
        .toList(growable: false);
  }

  void _openBalances(Json row) {
    final id = text(row, 'id');
    if (id.isEmpty) return;
    showDataDialog<void>(
      context,
      storageKey: 'warehouse-balances-$id',
      title: _arabic ? 'أرصدة ${_name(row)}' : '${_name(row)} balances',
      icon: Icons.account_balance_wallet_outlined,
      initialSize: const Size(1000, 640),
      child: WarehouseBalanceDialog(warehouseId: id),
    );
  }

  Future<void> _save({Json? existing}) async {
    final isEdit = existing != null;
    final arabic = _arabic;
    // The branch the warehouse belongs to is required by the server and can
    // never be guessed, so it is a text field rather than a hidden default:
    // the same screen then works for a company with one branch and for one
    // with twenty.
    final fields = [
      if (!isEdit)
        FieldSpec('code', arabic ? 'الكود' : 'Code', required: true),
      FieldSpec('nameEn', 'Name (English)'),
      FieldSpec('nameAr', 'الاسم (عربي)'),
      FieldSpec(
        'branchId',
        arabic ? 'معرّف الفرع' : 'Branch id',
        required: true,
        helper: arabic
            ? 'الفرع الذي يتبع له المستودع.'
            : 'The branch this warehouse belongs to.',
      ),
      FieldSpec(
        'address',
        arabic ? 'العنوان' : 'Address',
        maxLines: 2,
      ),
      FieldSpec(
        'isDefault',
        arabic ? 'المستودع الافتراضي للفرع' : 'Default for the branch',
        kind: FieldKind.toggle,
        helper: arabic
            ? 'أول مستودع في الفرع يصبح افتراضيًا تلقائيًا.'
            : 'The first warehouse of a branch becomes the default.',
      ),
    ];

    final values = await showFormSheet(
      context,
      title: isEdit
          ? (arabic ? 'تعديل مستودع' : 'Edit warehouse')
          : (arabic ? 'مستودع جديد' : 'New warehouse'),
      fields: fields,
      initial: existing ?? const {},
      onSubmit: (entered) async {
        await _submit(entered, existing: existing);
      },
    );
    if (values == null || !mounted) return;
    await ref.read(warehousesListProvider.notifier).reload();
  }

  /// Sends the form. A failure is thrown back into the sheet so it stays open
  /// with the typed values, which is how every other form in the program
  /// behaves.
  Future<void> _submit(Json entered, {Json? existing}) async {
    final client = ref.read(apiClientProvider);
    if (existing == null) {
      await client.post('/inventory/warehouses', body: entered);
    } else {
      await client.patch(
        '/inventory/warehouses/${existing['id']}',
        body: entered,
      );
    }
  }

  Future<void> _toggleActive(Json row) async {
    final l10n = context.l10n;
    final isActive = flag(row, 'isActive', fallback: true);
    if (isActive) {
      final ok = await confirmAction(
        context,
        title: l10n.deactivate,
        message: _arabic
            ? 'المستودع لا يُحذف، بل يُوقف. المستندات القديمة تظل تشير إليه.'
            : 'A warehouse is not deleted, it is switched off. Old documents keep naming it.',
        confirmLabel: l10n.deactivate,
        destructive: true,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      final id = row['id'];
      await client.post(
        isActive
            ? '/inventory/warehouses/$id/deactivate'
            : '/inventory/warehouses/$id/reactivate',
      );
      await ref.read(warehousesListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } catch (error) {
      if (mounted) {
        ref.invalidate(warehousesListProvider);
        await showAppError(context, error);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
