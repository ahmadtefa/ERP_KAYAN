import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/cost_center_providers.dart';

/// Cost centers: the answer to "whose cost is this?".
///
/// The screen never invents accounting rules of its own. Creating, moving and
/// deactivating are the server's decisions, so a refusal (a cycle, a duplicate
/// code) is shown exactly as the server phrased it.
class CostCentersScreen extends ConsumerStatefulWidget {
  const CostCentersScreen({super.key});

  @override
  ConsumerState<CostCentersScreen> createState() => _CostCentersScreenState();
}

class _CostCentersScreenState extends ConsumerState<CostCentersScreen> {
  String _query = '';
  String _type = '';
  String _status = '';
  String _parent = '';
  bool _busy = false;

  String _nameOf(Json row) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = text(row, arabic ? 'nameAr' : 'nameEn');
    return name.isEmpty ? text(row, 'nameEn') : name;
  }

  String _typeLabel(BuildContext context, String type) {
    final l10n = context.l10n;
    return switch (type) {
      'DEPARTMENT' => l10n.department,
      'ADMINISTRATIVE_UNIT' => l10n.administrativeUnit,
      'PROJECT' => l10n.project,
      _ => type,
    };
  }

  Future<void> _refresh() async {
    ref.invalidate(costCentersProvider);
    await ref.read(costCentersProvider.future);
  }

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final rows = ref.read(costCentersProvider).value ?? const <Json>[];
    final isEdit = existing != null;
    final selfId = existing == null ? '' : text(existing, 'id');

    final fields = <FieldSpec>[
      if (!isEdit) FieldSpec('code', l10n.costCenterCode, required: true),
      FieldSpec('nameEn', l10n.nameEnglish, required: true),
      FieldSpec('nameAr', l10n.nameArabic, required: true),
      FieldSpec(
        'type',
        l10n.costCenterType,
        kind: FieldKind.select,
        required: true,
        options: [
          FieldOption('DEPARTMENT', l10n.department),
          FieldOption('ADMINISTRATIVE_UNIT', l10n.administrativeUnit),
          FieldOption('PROJECT', l10n.project),
        ],
      ),
      FieldSpec(
        'parentId',
        l10n.parentCostCenter,
        kind: FieldKind.select,
        options: [
          FieldOption('none', l10n.noParent),
          for (final row in rows)
            if (text(row, 'id') != selfId)
              FieldOption(
                text(row, 'id'),
                '${text(row, 'code')} — ${_nameOf(row)}',
              ),
        ],
      ),
      FieldSpec('responsiblePerson', l10n.responsiblePerson),
      FieldSpec('startDate', l10n.startDate, kind: FieldKind.date),
      FieldSpec('endDate', l10n.endDate, kind: FieldKind.date),
      FieldSpec('description', l10n.description, kind: FieldKind.multiline, maxLines: 2),
      if (isEdit) FieldSpec('isActive', l10n.active, kind: FieldKind.toggle),
    ];

    final values = await showFormSheet(
      context,
      title: isEdit ? l10n.editCostCenter : l10n.newCostCenter,
      fields: fields,
      // A date the user cleared must be sent as a removal; a select left at
      // "no parent" must clear the parent rather than be ignored.
      initial: isEdit
          ? {
              ...existing,
              'parentId': text(existing, 'parentId').isEmpty
                  ? 'none'
                  : text(existing, 'parentId'),
              'startDate': text(existing, 'startDate'),
              'endDate': text(existing, 'endDate'),
            }
          : {'type': 'DEPARTMENT', 'isActive': true, 'parentId': 'none'},
    );
    if (values == null || !mounted) return;

    final parentId = values.remove('parentId');
    final body = <String, dynamic>{
      ...values,
      // "No parent" is a real choice, not a missing value: it moves the centre
      // to the root of the tree.
      if (parentId != null) 'parentId': parentId == 'none' ? null : parentId,
    };

    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isEdit) {
        await client.patch('/accounting/cost-centers/${existing['id']}', body: body);
      } else {
        await client.post('/accounting/cost-centers', body: body);
      }
      await _refresh();
      if (mounted) showMessage(context, l10n.costCenterSaved);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggle(Json row) async {
    final l10n = context.l10n;
    final active = flag(row, 'isActive', fallback: true);
    if (active) {
      final ok = await confirmAction(
        context,
        title: l10n.deactivate,
        message: l10n.confirmDeactivateCostCenter,
        confirmLabel: l10n.deactivate,
        destructive: true,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).patch(
        '/accounting/cost-centers/${row['id']}',
        body: {'isActive': !active},
      );
      await _refresh();
      if (mounted) showMessage(context, l10n.costCenterSaved);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(Json row) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.deleteCostCenter,
      message: l10n.confirmDeleteCostCenter,
      confirmLabel: l10n.deleteRecord,
      destructive: true,
    );
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).delete('/accounting/cost-centers/${row['id']}');
      await _refresh();
      if (mounted) showMessage(context, l10n.costCenterDeleted);
    } on Failure catch (error) {
      // The server refuses to delete a referenced centre and says why.
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showDetails(Json row) async {
    final l10n = context.l10n;
    final client = ref.read(apiClientProvider);
    Json detail;
    try {
      detail = await client.getObject('/accounting/cost-centers/${row['id']}');
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
      return;
    }
    if (!mounted) return;
    final usage = detail['usage'] is Map
        ? Map<String, dynamic>.from(detail['usage'] as Map)
        : <String, dynamic>{};
    final children = listOf(detail['children']);
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('${text(row, 'code')} — ${_nameOf(row)}'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _detailLine(l10n.costCenterType, _typeLabel(dialogContext, text(row, 'type'))),
              _detailLine(l10n.parentCostCenter, _parentLabel(row)),
              _detailLine(l10n.responsiblePerson, text(row, 'responsiblePerson')),
              _detailLine(l10n.startDate, text(row, 'startDate')),
              _detailLine(l10n.endDate, text(row, 'endDate')),
              _detailLine(l10n.description, text(row, 'description')),
              _detailLine(l10n.status,
                flag(row, 'isActive', fallback: true) ? l10n.active : l10n.inactive,
              ),
              const Divider(height: 24),
              Text(l10n.usage, style: Theme.of(dialogContext).textTheme.titleSmall),
              const SizedBox(height: 6),
              Text('${l10n.journalLinesUsing}: ${usage['journalLines'] ?? 0}'),
              Text('${l10n.allocatedLinesUsing}: ${usage['allocatedLines'] ?? 0}'),
              if (children.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text('${l10n.rolledUp}: ${children.map((c) => text(c, 'code')).join(', ')}'),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.close),
          ),
        ],
      ),
    );
  }

  Widget _detailLine(String label, String value) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text('$label: $value'),
    );
  }

  String _parentLabel(Json row) {
    final id = text(row, 'parentId');
    if (id.isEmpty) return '';
    final rows = ref.read(costCentersProvider).value ?? const <Json>[];
    for (final parent in rows) {
      if (text(parent, 'id') == id) return text(parent, 'code');
    }
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(costCentersProvider);
    final canManage =
        ref.watch(currentUserProvider)?.can('accounting.costcenters.manage') ?? false;

    return ModuleScaffold(
      title: l10n.costCenters,
      trailing: Row(
        children: [
          SearchField(
            hint: l10n.searchCostCenters,
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
          const SizedBox(width: 12),
          if (canManage)
            FilledButton.icon(
              onPressed: _busy ? null : () => _save(),
              icon: const Icon(Icons.add),
              label: Text(l10n.newCostCenter),
            ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.invalidate(costCentersProvider),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: l10n.noCostCenters,
        data: (rows) {
          final visible = _filter(rows);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    _Filter(
                      value: _type,
                      label: l10n.costCenterType,
                      options: {
                        '': l10n.allTypes,
                        'DEPARTMENT': l10n.department,
                        'ADMINISTRATIVE_UNIT': l10n.administrativeUnit,
                        'PROJECT': l10n.project,
                      },
                      onChanged: (value) => setState(() => _type = value),
                    ),
                    _Filter(
                      value: _status,
                      label: l10n.status,
                      options: {
                        '': l10n.allStatuses,
                        'active': l10n.active,
                        'inactive': l10n.inactive,
                      },
                      onChanged: (value) => setState(() => _status = value),
                    ),
                    _Filter(
                      value: _parent,
                      label: l10n.parentCostCenter,
                      options: {
                        '': l10n.allParents,
                        'root': l10n.noParent,
                        for (final row in rows)
                          text(row, 'id'): '${text(row, 'code')} — ${_nameOf(row)}',
                      },
                      onChanged: (value) => setState(() => _parent = value),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: RecordsTable(
                  rows: visible,
                  onTap: (row) => _showDetails(row),
                  columns: [
                    ColumnSpec(
                      l10n.costCenterCode,
                      emphasise: true,
                      value: (row) {
                        final depth = (row['depth'] as num?)?.toInt() ?? 0;
                        return '${'   ' * depth}${text(row, 'code')}';
                      },
                    ),
                    ColumnSpec(l10n.nameEnglish, value: (row) => text(row, 'nameEn')),
                    ColumnSpec(l10n.nameArabic, value: (row) => text(row, 'nameAr')),
                    ColumnSpec(l10n.costCenterType, value: (row) => _typeLabel(context, text(row, 'type'))),
                    ColumnSpec(l10n.parentCostCenter, value: _parentLabel),
                    ColumnSpec(l10n.responsiblePerson, value: (row) => text(row, 'responsiblePerson')),
                    ColumnSpec(
                      l10n.status,
                      value: (row) => flag(row, 'isActive', fallback: true)
                          ? l10n.active
                          : l10n.inactive,
                      tone: (row) => flag(row, 'isActive', fallback: true)
                          ? AppTone.success
                          : AppTone.neutral,
                    ),
                  ],
                  actions: (row) => [
                    IconButton(
                      tooltip: l10n.drillDown,
                      icon: const Icon(Icons.info_outline, size: 20),
                      onPressed: () => _showDetails(row),
                    ),
                    if (canManage)
                      IconButton(
                        tooltip: l10n.edit,
                        icon: const Icon(Icons.edit_outlined, size: 20),
                        onPressed: _busy ? null : () => _save(existing: row),
                      ),
                    if (canManage)
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
                        onPressed: _busy ? null : () => _toggle(row),
                      ),
                    if (canManage)
                      IconButton(
                        tooltip: l10n.deleteCostCenter,
                        icon: const Icon(Icons.delete_outline, size: 20),
                        onPressed: _busy ? null : () => _delete(row),
                      ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  List<Json> _filter(List<Json> rows) {
    final needle = _query.toLowerCase();
    final byId = <String, Json>{for (final row in rows) text(row, 'id'): row};
    return rows.where((row) {
      if (_type.isNotEmpty && text(row, 'type') != _type) return false;
      if (_status == 'active' && !flag(row, 'isActive', fallback: true)) return false;
      if (_status == 'inactive' && flag(row, 'isActive', fallback: true)) return false;
      if (_parent == 'root' && text(row, 'parentId').isNotEmpty) return false;
      if (_parent.isNotEmpty && _parent != 'root') {
        if (text(row, 'parentId') != _parent) return false;
      }
      if (needle.isEmpty) return true;
      final parentCode = byId[text(row, 'parentId')] == null
          ? ''
          : text(byId[text(row, 'parentId')]!, 'code');
      return text(row, 'code').toLowerCase().contains(needle) ||
          text(row, 'nameEn').toLowerCase().contains(needle) ||
          text(row, 'nameAr').contains(_query) ||
          text(row, 'responsiblePerson').toLowerCase().contains(needle) ||
          parentCode.toLowerCase().contains(needle);
    }).toList(growable: false);
  }
}

class _Filter extends StatelessWidget {
  const _Filter({
    required this.value,
    required this.label,
    required this.options,
    required this.onChanged,
  });

  final String value;
  final String label;
  final Map<String, String> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 210,
      child: DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(
          labelText: label,
          isDense: true,
          border: const OutlineInputBorder(),
        ),
        items: [
          for (final entry in options.entries)
            DropdownMenuItem(
              value: entry.key,
              child: Text(entry.value, overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: (next) => onChanged(next ?? ''),
      ),
    );
  }
}
