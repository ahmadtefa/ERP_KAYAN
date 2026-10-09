import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';

/// Which of the two party lists a screen is showing.
enum PartyKind { customer, supplier }

class CustomersController extends JsonListController {
  @override
  String get resourcePath => '/parties/customers';

  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

class SuppliersController extends JsonListController {
  @override
  String get resourcePath => '/parties/suppliers';

  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

final customersListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      CustomersController.new,
    );

final suppliersListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      SuppliersController.new,
    );

/// Customers and suppliers, which differ only in the label and in whether a
/// credit limit applies.
class PartiesScreen extends ConsumerStatefulWidget {
  const PartiesScreen({super.key, required this.kind});

  final PartyKind kind;

  @override
  ConsumerState<PartiesScreen> createState() => _PartiesScreenState();
}

class _PartiesScreenState extends ConsumerState<PartiesScreen> {
  String _query = '';
  bool _busy = false;

  bool get _isCustomer => widget.kind == PartyKind.customer;

  String get _path =>
      _isCustomer ? '/parties/customers' : '/parties/suppliers';

  AsyncNotifierProvider<JsonListController, List<Json>> get _provider =>
      _isCustomer ? customersListProvider : suppliersListProvider;

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final fields = <FieldSpec>[
      if (!isEdit)
        FieldSpec('code', l10n.accountCode, required: true),
      FieldSpec('nameEn', 'Name (English)', required: true),
      FieldSpec('nameAr', 'الاسم (عربي)', required: true),
      FieldSpec('phone', l10n.phone),
      FieldSpec('email', l10n.email),
      FieldSpec('taxNumber', l10n.taxNumber),
      FieldSpec('address', l10n.address, kind: FieldKind.multiline, maxLines: 2),
      if (_isCustomer)
        FieldSpec(
          'creditLimit',
          l10n.creditLimit,
          kind: FieldKind.decimal,
          helper: l10n.creditLimitNote,
        ),
      FieldSpec('notes', l10n.description, kind: FieldKind.multiline, maxLines: 2),
    ];

    final values = await showFormSheet(
      context,
      title: isEdit
          ? (_isCustomer ? l10n.editCustomer : l10n.editSupplier)
          : (_isCustomer ? l10n.newCustomer : l10n.newSupplier),
      fields: fields,
      initial: existing,
    );
    if (values == null || !mounted) return;

    setState(() => _busy = true);
    final client = ref.read(apiClientProvider);
    try {
      if (isEdit) {
        await client.patch('$_path/${existing['id']}', body: values);
      } else {
        await client.post(_path, body: values);
      }
      await ref.read(_provider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleActive(Json row) async {
    final l10n = context.l10n;
    final isActive = flag(row, 'isActive', fallback: true);
    if (isActive) {
      final ok = await confirmAction(
        context,
        title: l10n.deactivate,
        message: l10n.confirmReverse,
        confirmLabel: l10n.deactivate,
        destructive: true,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isActive) {
        await client.post('$_path/${row['id']}/deactivate');
      } else {
        await client.patch('$_path/${row['id']}', body: {'isActive': true});
      }
      await ref.read(_provider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(_provider);
    final title = _isCustomer ? l10n.customers : l10n.suppliers;

    return ModuleScaffold(
      title: title,
      actions: [
        ListExportActions(list: _isCustomer ? 'customers' : 'suppliers'),
      ],
      trailing: Row(
        children: [
          SearchField(
            hint: l10n.searchParties,
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
          const SizedBox(width: 12),
          FilledButton.icon(
            onPressed: _busy ? null : () => _save(),
            icon: const Icon(Icons.add),
            label: Text(_isCustomer ? l10n.newCustomer : l10n.newSupplier),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(_provider.notifier).reload(),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: _isCustomer ? l10n.noCustomers : l10n.noSuppliers,
        data: (rows) => RecordsTable(
          rows: _filter(rows),
          columns: [
            ColumnSpec(l10n.accountCode, value: (r) => text(r, 'code'), emphasise: true),
            ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
            ColumnSpec('الاسم', value: (r) => text(r, 'nameAr')),
            ColumnSpec(l10n.phone, value: (r) => text(r, 'phone')),
            if (_isCustomer)
              ColumnSpec(
                l10n.creditLimit,
                numeric: true,
                value: (r) => formatAmount(asString(r['creditLimit'])),
              ),
            ColumnSpec(
              l10n.status,
              value: (r) => flag(r, 'isActive', fallback: true)
                  ? l10n.active
                  : l10n.inactive,
            ),
          ],
          actions: (row) => [
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
              text(r, 'nameAr').contains(_query),
        )
        .toList(growable: false);
  }
}
