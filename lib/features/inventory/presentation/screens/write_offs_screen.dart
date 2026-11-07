import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Goods destroyed, spoiled, stolen or expired - a loss with its own number.
///
/// A write-off is not a separate table: it is a stock document of kind
/// WRITE_OFF, moving through the same document engine as every other stock
/// document - created, approved by somebody other than its creator, then
/// posted. This screen shows that one kind and the two steps that finish it;
/// the rest of the engine is left exactly as it is.
///
/// The list is narrowed server-side by branch and by warehouse grant, so the
/// filter below can only hide rows, never reveal them.
final writeOffsProvider = AsyncNotifierProvider<WriteOffsController, List<Json>>(
  WriteOffsController.new,
);

class WriteOffsController extends JsonListController {
  @override
  String get resourcePath => '/inventory/stock-documents';

  /// `kind` is the server's own filter, so the list cannot drift from what the
  /// detail screen says the document is.
  @override
  Map<String, dynamic> get resourceQuery => const {'kind': 'WRITE_OFF'};
}

class WriteOffsScreen extends ConsumerStatefulWidget {
  const WriteOffsScreen({super.key});

  @override
  ConsumerState<WriteOffsScreen> createState() => _WriteOffsScreenState();
}

class _WriteOffsScreenState extends ConsumerState<WriteOffsScreen> {
  String _query = '';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  /// The server lowercases both, so the labels map from lowercase.
  String _statusLabel(String status) {
    final arabic = _arabic;
    return switch (status) {
      'draft' => arabic ? 'مسودة' : 'Draft',
      'posted' => arabic ? 'مُرحَّل' : 'Posted',
      'reversed' => arabic ? 'معكوس' : 'Reversed',
      _ => status,
    };
  }

  AppTone _statusTone(String status) {
    return switch (status) {
      'posted' => AppTone.success,
      'reversed' => AppTone.danger,
      _ => AppTone.neutral,
    };
  }

  String _warehouseName(Json row) {
    final warehouse = row['fromWarehouse'];
    if (warehouse is! Map) return '';
    final json = Map<String, dynamic>.from(warehouse);
    return _arabic ? text(json, 'nameAr') : text(json, 'nameEn');
  }

  /// A draft that somebody has signed is waiting only for posting. The summary
  /// carries the approval stamp, so the two states are told apart here rather
  /// than assumed from the status alone.
  bool _isApprovedDraft(Json row) =>
      text(row, 'status') == 'draft' && row['approvedAt'] != null;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(writeOffsProvider);
    final user = ref.watch(currentUserProvider);
    final canApprove = user?.can('inventory.writeoff.approve') ?? false;
    final canPost = user?.can('inventory.writeoff.post') ?? false;

    return ModuleScaffold(
      title: _arabic ? 'الإعدام' : 'Write-offs',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      trailing: SearchField(
        hint: _arabic ? 'بحث في الإعدام' : 'Search write-offs',
        onChanged: (value) => setState(() => _query = value.trim()),
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(writeOffsProvider.notifier).reload(),
        isEmpty: (rows) => _visible(rows).isEmpty,
        emptyMessage: _arabic
            ? 'لا توجد عمليات إعدام.'
            : 'No write-offs.',
        data: (rows) => RecordsTable(
          rows: _visible(rows),
          columns: [
            ColumnSpec(
              _arabic ? 'الرقم' : 'Number',
              value: (r) => text(r, 'documentNumber'),
              emphasise: true,
            ),
            ColumnSpec(
              _arabic ? 'التاريخ' : 'Date',
              value: (r) => text(r, 'documentDate'),
            ),
            ColumnSpec(
              _arabic ? 'المستودع' : 'Warehouse',
              value: _warehouseName,
            ),
            ColumnSpec(
              _arabic ? 'الكمية' : 'Quantity',
              numeric: true,
              value: (r) => formatQuantity(asString(r['totalQuantity'])),
            ),
            ColumnSpec(
              _arabic ? 'السبب' : 'Reason',
              value: (r) => text(r, 'reason'),
            ),
            ColumnSpec(
              _arabic ? 'أنشأه' : 'Raised by',
              value: (r) => text(r, 'createdByName'),
            ),
            ColumnSpec(
              _arabic ? 'اعتمده' : 'Approved by',
              value: (r) => text(r, 'approvedByName'),
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => _isApprovedDraft(r)
                  ? (_arabic ? 'بانتظار الترحيل' : 'Awaiting posting')
                  : _statusLabel(text(r, 'status')),
              tone: (r) => _isApprovedDraft(r)
                  ? AppTone.warning
                  : _statusTone(text(r, 'status')),
            ),
          ],
          actions: (row) => _actions(row, canApprove, canPost),
        ),
      ),
    );
  }

  /// Approving and posting are separate grants, and the engine refuses both
  /// for the person who raised the document.
  List<Widget> _actions(Json row, bool canApprove, bool canPost) {
    final status = text(row, 'status');
    final raisedByMe =
        text(row, 'createdById') == ref.read(currentUserProvider)?.id;
    final actions = <Widget>[];

    if (canApprove && status == 'draft' && !_isApprovedDraft(row)) {
      actions.add(
        IconButton(
          tooltip: raisedByMe
              ? (_arabic
                    ? 'رفعت هذا المستند، فلا يمكنك اعتماده'
                    : 'You raised this document, so you cannot approve it')
              : (_arabic ? 'اعتماد' : 'Approve'),
          icon: const Icon(Icons.verified_outlined),
          onPressed: raisedByMe ? null : () => _approve(row),
        ),
      );
    }

    if (canPost && _isApprovedDraft(row)) {
      actions.add(
        IconButton(
          tooltip: _arabic ? 'ترحيل' : 'Post',
          icon: const Icon(Icons.play_arrow_outlined),
          onPressed: () => _post(row),
        ),
      );
    }

    return actions;
  }

  Future<void> _approve(Json row) async {
    final confirmed = await confirmAction(
      context,
      title: _arabic ? 'اعتماد الإعدام' : 'Approve the write-off',
      message: _arabic
          ? 'سيُعتمد إعدام «${text(row, 'documentNumber')}». الأرصدة لا تتحرك إلا بالترحيل.'
          : 'Write-off "${text(row, 'documentNumber')}" will be approved. '
                'Stock does not move until it is posted.',
      confirmLabel: _arabic ? 'اعتماد' : 'Approve',
    );
    if (!confirmed || !mounted) return;
    await _send('/inventory/stock-documents/${text(row, 'id')}/write-off/approve');
  }

  Future<void> _post(Json row) async {
    final confirmed = await confirmAction(
      context,
      title: _arabic ? 'ترحيل الإعدام' : 'Post the write-off',
      message: _arabic
          ? 'ستُنقص الكمية من المخزون ويُسجَّل القيد. لا يمكن التراجع.'
          : 'The quantity will leave stock and the journal entry will be '
                'written. This cannot be undone.',
      confirmLabel: _arabic ? 'ترحيل' : 'Post',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    await _send('/inventory/stock-documents/${text(row, 'id')}/write-off/post');
  }

  Future<void> _send(String path) async {
    try {
      await ref.read(apiClientProvider).post(path);
      await ref.read(writeOffsProvider.notifier).refreshQuietly();
      if (!mounted) return;
      showMessage(context, _arabic ? 'تم' : 'Done');
    } catch (error) {
      if (!mounted) return;
      showMessage(context, error, error: true);
    }
  }

  List<Json> _visible(List<Json> rows) {
    if (_query.isEmpty) return rows;
    final needle = _query.toLowerCase();
    return rows
        .where(
          (row) =>
              text(row, 'documentNumber').toLowerCase().contains(needle) ||
              text(row, 'reason').toLowerCase().contains(needle) ||
              _warehouseName(row).toLowerCase().contains(needle),
        )
        .toList(growable: false);
  }
}
