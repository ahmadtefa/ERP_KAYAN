import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Every stock document that is not a voucher: adjustments, transfers,
/// counts, opening balances and write-offs.
///
/// This is the same endpoint the vouchers screen reads, split by the server's
/// own parameter. Vouchers are an inventory request raised by one branch and
/// fulfilled by another - they have their own list, their own detail and their
/// own creation flow, and they are deliberately not shown here. `voucherOnly`
/// is false, not missing, so the two screens cannot overlap.
final stockDocumentsProvider =
    AsyncNotifierProvider<StockDocumentsController, List<Json>>(
      StockDocumentsController.new,
    );

class StockDocumentsController extends JsonListController {
  @override
  String get resourcePath => '/inventory/stock-documents';

  @override
  Map<String, dynamic> get resourceQuery => const {'voucherOnly': 'false'};
}

/// The kinds this screen lists. Write-off is included because it is a stock
/// document; it also has its own screen, which is where it is approved.
const _kinds = ['ADJUSTMENT', 'TRANSFER', 'COUNT', 'OPENING', 'WRITE_OFF'];

class StockDocumentsScreen extends ConsumerStatefulWidget {
  const StockDocumentsScreen({super.key});

  @override
  ConsumerState<StockDocumentsScreen> createState() =>
      _StockDocumentsScreenState();
}

class _StockDocumentsScreenState extends ConsumerState<StockDocumentsScreen> {
  String _query = '';
  String? _kind;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _kindLabel(String kind) {
    final arabic = _arabic;
    return switch (kind.toUpperCase()) {
      'ADJUSTMENT' => arabic ? 'تسوية' : 'Adjustment',
      'TRANSFER' => arabic ? 'تحويل' : 'Transfer',
      'COUNT' => arabic ? 'جرد' : 'Count',
      'OPENING' => arabic ? 'رصيد افتتاحي' : 'Opening',
      'WRITE_OFF' => arabic ? 'إعدام' : 'Write-off',
      _ => kind,
    };
  }

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

  /// Where the goods went. A write-off or an opening balance has no
  /// destination, so the column falls back to where they left from.
  String _movement(Json row) {
    String name(Object? value) {
      if (value is! Map) return '';
      final json = Map<String, dynamic>.from(value);
      return _arabic ? text(json, 'nameAr') : text(json, 'nameEn');
    }

    final from = name(row['fromWarehouse']);
    final to = name(row['toWarehouse']);
    if (from.isEmpty && to.isEmpty) return '';
    if (to.isEmpty) return from;
    if (from.isEmpty) return '→ $to';
    return '$from → $to';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(stockDocumentsProvider);

    return ModuleScaffold(
      title: _arabic ? 'مستندات المخزون' : 'Stock documents',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      trailing: Row(
        children: [
          DropdownButton<String?>(
            value: _kind,
            isDense: true,
            hint: Text(_arabic ? 'كل الأنواع' : 'All kinds'),
            items: [
              DropdownMenuItem(
                value: null,
                child: Text(_arabic ? 'كل الأنواع' : 'All kinds'),
              ),
              for (final kind in _kinds)
                DropdownMenuItem(
                  value: kind,
                  child: Text(_kindLabel(kind)),
                ),
            ],
            onChanged: (value) => setState(() => _kind = value),
          ),
          const SizedBox(width: 12),
          SearchField(
            hint: _arabic ? 'بحث في المستندات' : 'Search documents',
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(stockDocumentsProvider.notifier).reload(),
        isEmpty: (rows) => _visible(rows).isEmpty,
        emptyMessage: _arabic
            ? 'لا توجد مستندات مخزون.'
            : 'No stock documents.',
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
              _arabic ? 'النوع' : 'Kind',
              value: (r) => _kindLabel(text(r, 'kind')),
            ),
            ColumnSpec(_arabic ? 'الحركة' : 'Movement', value: _movement),
            ColumnSpec(
              _arabic ? 'الكمية' : 'Quantity',
              numeric: true,
              value: (r) => formatQuantity(asString(r['totalQuantity'])),
            ),
            ColumnSpec(
              _arabic ? 'الفرع' : 'Branch',
              value: (r) {
                final branch = r['branch'];
                if (branch is! Map) return '';
                final json = Map<String, dynamic>.from(branch);
                return _arabic ? text(json, 'nameAr') : text(json, 'nameEn');
              },
            ),
            ColumnSpec(
              _arabic ? 'أنشأه' : 'Raised by',
              value: (r) => text(r, 'createdByName'),
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => _statusLabel(text(r, 'status')),
              tone: (r) => _statusTone(text(r, 'status')),
            ),
          ],
        ),
      ),
    );
  }

  List<Json> _visible(List<Json> rows) {
    var filtered = rows;
    if (_kind != null) {
      filtered = filtered
          .where((row) => text(row, 'kind').toUpperCase() == _kind)
          .toList(growable: false);
    }
    if (_query.isEmpty) return filtered;
    final needle = _query.toLowerCase();
    return filtered
        .where(
          (row) =>
              text(row, 'documentNumber').toLowerCase().contains(needle) ||
              text(row, 'createdByName').toLowerCase().contains(needle) ||
              _movement(row).toLowerCase().contains(needle),
        )
        .toList(growable: false);
  }
}
