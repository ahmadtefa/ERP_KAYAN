import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Counting a warehouse, and the approval that turns a difference into a loss.
///
/// The backend models this as a session: it is opened, counted, approved by
/// somebody other than the person who opened it, and only then posted - which
/// is when stock and the ledger actually move. Each of those steps is a
/// different permission, so this screen shows only the step the caller is
/// allowed to take, and greys out the rest rather than offering a button that
/// can only fail.
final stockTakesProvider =
    AsyncNotifierProvider<StockTakesController, List<Json>>(
      StockTakesController.new,
    );

class StockTakesController extends JsonListController {
  @override
  String get resourcePath => '/inventory/stock-takes';
}

class StockTakesScreen extends ConsumerStatefulWidget {
  const StockTakesScreen({super.key});

  @override
  ConsumerState<StockTakesScreen> createState() => _StockTakesScreenState();
}

class _StockTakesScreenState extends ConsumerState<StockTakesScreen> {
  String _query = '';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _statusLabel(String status) {
    final arabic = _arabic;
    return switch (status.toUpperCase()) {
      'DRAFT' => arabic ? 'مسودة' : 'Draft',
      'COUNTING' => arabic ? 'جارٍ العد' : 'Counting',
      'REVIEW' => arabic ? 'قيد المراجعة' : 'In review',
      'APPROVED' => arabic ? 'معتمد' : 'Approved',
      'POSTED' => arabic ? 'مُرحَّل' : 'Posted',
      'CANCELLED' => arabic ? 'ملغى' : 'Cancelled',
      _ => status,
    };
  }

  AppTone _statusTone(String status) {
    return switch (status.toUpperCase()) {
      'APPROVED' => AppTone.success,
      'POSTED' => AppTone.info,
      'CANCELLED' => AppTone.neutral,
      'REVIEW' => AppTone.warning,
      _ => AppTone.neutral,
    };
  }

  String _warehouseName(Json row) {
    return _arabic
        ? (asString(row['warehouseNameAr']) ?? '')
        : (asString(row['warehouseNameEn']) ?? '');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(stockTakesProvider);
    final user = ref.watch(currentUserProvider);
    final canApprove = user?.can('inventory.stocktake.approve') ?? false;
    final canPost = user?.can('inventory.stocktake.post') ?? false;

    return ModuleScaffold(
      title: _arabic ? 'الجرد' : 'Stock takes',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      trailing: SearchField(
        hint: _arabic ? 'بحث في الجرد' : 'Search counts',
        onChanged: (value) => setState(() => _query = value.trim()),
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(stockTakesProvider.notifier).reload(),
        isEmpty: (rows) => _visible(rows).isEmpty,
        emptyMessage: _arabic
            ? 'لا توجد عمليات جرد بعد.'
            : 'No stock takes yet.',
        data: (rows) => RecordsTable(
          rows: _visible(rows),
          columns: [
            ColumnSpec(
              _arabic ? 'الكود' : 'Code',
              value: (r) => text(r, 'code'),
              emphasise: true,
            ),
            ColumnSpec(
              _arabic ? 'المستودع' : 'Warehouse',
              value: _warehouseName,
            ),
            ColumnSpec(
              _arabic ? 'النطاق' : 'Scope',
              value: (r) => text(r, 'scope') == 'FULL'
                  ? (_arabic ? 'كامل' : 'Full')
                  : (_arabic ? 'جزئي' : 'Partial'),
            ),
            ColumnSpec(
              _arabic ? 'البنود' : 'Lines',
              numeric: true,
              value: (r) => r['lineCount'] == null
                  ? '—'
                  : asString(r['lineCount'])!,
            ),
            ColumnSpec(
              _arabic ? 'تاريخ الفتح' : 'Opened',
              value: (r) => asString(r['createdAt'])?.split('T').first ?? '—',
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => _statusLabel(text(r, 'status')),
              tone: (r) => _statusTone(text(r, 'status')),
            ),
          ],
          actions: (row) => _actions(row, canApprove, canPost),
        ),
      ),
    );
  }

  /// Only the steps the backend would accept, and only for the caller's grant.
  ///
  /// Approving is refused server-side when the same person opened the count,
  /// so the button is offered disabled with the reason on it instead of letting
  /// someone click through to an error.
  List<Widget> _actions(Json row, bool canApprove, bool canPost) {
    final status = text(row, 'status').toUpperCase();
    final openedByMe =
        text(row, 'createdBy') == ref.read(currentUserProvider)?.id;
    final actions = <Widget>[];

    if (canApprove && (status == 'COUNTING' || status == 'REVIEW')) {
      actions.add(
        IconButton(
          tooltip: openedByMe
              ? (_arabic
                    ? 'فتحت هذا الجرد، فلا يمكنك اعتماده'
                    : 'You opened this count, so you cannot approve it')
              : (_arabic ? 'اعتماد' : 'Approve'),
          icon: const Icon(Icons.verified_outlined),
          onPressed: openedByMe ? null : () => _approve(row),
        ),
      );
    }

    if (canPost && status == 'APPROVED') {
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
      title: _arabic ? 'اعتماد الجرد' : 'Approve the count',
      message: _arabic
          ? 'سيُعتمد الفرق في الجرد «${text(row, 'code')}». الاعتماد لا يحرّك الأرصدة بعد؛ الترحيل هو الذي يحرّكها.'
          : 'The differences in "${text(row, 'code')}" will be approved. '
                'Approving does not move stock yet; posting does.',
      confirmLabel: _arabic ? 'اعتماد' : 'Approve',
    );
    if (!confirmed || !mounted) return;
    await _send('/inventory/stock-takes/${text(row, 'id')}/approve');
  }

  Future<void> _post(Json row) async {
    final confirmed = await confirmAction(
      context,
      title: _arabic ? 'ترحيل الجرد' : 'Post the count',
      message: _arabic
          ? 'سيُرحَّل الجرد «${text(row, 'code')}» وتتحرك الأرصدة والقيود. لا يمكن التراجع.'
          : 'The count "${text(row, 'code')}" will be posted and stock and the '
                'ledger will move. This cannot be undone.',
      confirmLabel: _arabic ? 'ترحيل' : 'Post',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    await _send('/inventory/stock-takes/${text(row, 'id')}/post');
  }

  Future<void> _send(String path) async {
    try {
      await ref.read(apiClientProvider).post(path);
      await ref.read(stockTakesProvider.notifier).refreshQuietly();
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
              text(row, 'code').toLowerCase().contains(needle) ||
              _warehouseName(row).toLowerCase().contains(needle),
        )
        .toList(growable: false);
  }
}
