import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/design_tokens.dart';
import '../../../core/error/failure.dart';
import '../../../core/json/amount_format.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/extensions/l10n_extension.dart';
import '../../../shared/widgets/confirm_dialog.dart';
import '../../../shared/widgets/form_sheet.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/state_views.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/providers/resource_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';

/// The fixed-asset register.
///
/// A draft is just a record; activation posts the acquisition entry,
/// the monthly run charges straight-line depreciation, and disposal
/// takes the asset off the books with its gain or loss. The figures on
/// this screen — cost, accumulated depreciation, book value — are the
/// register's, and the summary ties them to the ledger accounts they
/// must equal.
class FixedAssetsController extends JsonListController {
  @override
  String get resourcePath => '/fixed-assets';
}

final fixedAssetsListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      FixedAssetsController.new,
    );

final fixedAssetsSummaryProvider = FutureProvider<Json>((ref) async {
  ref.watch(fixedAssetsListProvider);
  return ref.read(apiClientProvider).get('/fixed-assets/reports/summary');
});

class FixedAssetsScreen extends ConsumerStatefulWidget {
  const FixedAssetsScreen({super.key});

  @override
  ConsumerState<FixedAssetsScreen> createState() => _FixedAssetsScreenState();
}

class _FixedAssetsScreenState extends ConsumerState<FixedAssetsScreen> {
  bool _busy = false;
  final _search = TextEditingController();
  String? _statusFilter;
  String? _categoryFilter;

  String _t(String ar, String en) =>
      Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<List<Json>> _accounts() =>
      ref.read(apiClientProvider).getList('/accounting/chart-of-accounts');

  List<FieldOption> _options(List<Json> accounts, {String? type}) {
    return accounts
        .where(
          (a) =>
              flag(a, 'isPostable') &&
              (type == null || text(a, 'type') == type),
        )
        .map(
          (a) => FieldOption(
            text(a, 'id'),
            '${text(a, 'code')} — ${text(a, 'nameEn')}',
          ),
        )
        .toList();
  }

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final accounts = await _accounts();
    // Purchase lines that can still be capitalised. The list comes from
    // the server already net of returns and of other assets, so what
    // can be picked here is exactly what the create guard will accept.
    final purchaseLineOptions = <FieldOption>[];
    try {
      final body = await ref
          .read(apiClientProvider)
          .get('/fixed-assets/purchase-lines');
      for (final line in listOf(body['items'])) {
        purchaseLineOptions.add(
          FieldOption(
            text(line, 'lineId'),
            '${text(line, 'invoiceNumber')} · ${text(line, 'description')} · '
            '×${formatAmount(asString(line['remainingQuantity']))} '
            '(${formatAmount(asString(line['remainingCost']))})',
          ),
        );
      }
    } on Failure {
      // The link is optional; the form still works without the list.
    }
    final currentLine = existing?['purchaseInvoiceLineId']?.toString();
    if (currentLine != null &&
        !purchaseLineOptions.any((o) => o.value == currentLine)) {
      purchaseLineOptions.add(
        FieldOption(currentLine, _t('بند شراء مرتبط', 'Linked purchase line')),
      );
    }
    if (!mounted) return;
    final values = await showFormSheet(
      context,
      title: isEdit ? l10n.editAsset : l10n.newAsset,
      fields: [
        if (!isEdit) FieldSpec('code', l10n.assetCode),
        FieldSpec('nameEn', l10n.fullNameEn, required: true),
        FieldSpec('nameAr', l10n.fullNameAr, required: true),
        FieldSpec('category', l10n.assetCategory),
        FieldSpec('description', l10n.description, kind: FieldKind.multiline),
        FieldSpec(
          'purchaseDate',
          l10n.purchaseDate,
          kind: FieldKind.date,
          required: true,
        ),
        FieldSpec(
          'inServiceDate',
          l10n.inServiceDate,
          kind: FieldKind.date,
          required: true,
        ),
        FieldSpec(
          'cost',
          l10n.assetCost,
          kind: FieldKind.decimal,
          required: true,
        ),
        FieldSpec('salvageValue', l10n.salvageValue, kind: FieldKind.decimal),
        FieldSpec(
          'usefulLifeMonths',
          l10n.usefulLifeMonths,
          kind: FieldKind.integer,
          required: true,
        ),
        FieldSpec(
          'assetAccountId',
          l10n.assetAccount,
          kind: FieldKind.select,
          required: true,
          options: _options(accounts, type: 'asset'),
        ),
        FieldSpec(
          'accumulatedAccountId',
          l10n.accumulatedAccount,
          kind: FieldKind.select,
          required: true,
          options: _options(accounts, type: 'asset'),
        ),
        FieldSpec(
          'expenseAccountId',
          l10n.depreciationExpenseAccount,
          kind: FieldKind.select,
          required: true,
          options: _options(accounts, type: 'expense'),
        ),
        FieldSpec('location', l10n.assetLocation),
        FieldSpec(
          'purchaseInvoiceLineId',
          _t('بند فاتورة الشراء (اختياري)', 'Purchase invoice line (optional)'),
          kind: FieldKind.select,
          options: purchaseLineOptions,
          helper: _t(
            'عند الربط تُرحَّل التكلفة عند التفعيل من المخزون لا نقدًا، ولا يمكن رسملة البند مرتين',
            'When linked, activation reclassifies the cost out of inventory; a line cannot be capitalised twice',
          ),
        ),
        FieldSpec(
          'purchaseQuantity',
          _t('الكمية من البند', 'Units from the line'),
          kind: FieldKind.decimal,
        ),
      ],
      initial: existing,
    );
    if (values == null || !mounted) return;
    // Empty optionals travel as absence, not as empty strings the API
    // would have to guess at.
    values.removeWhere(
      (key, value) => value == null || (value is String && value.trim().isEmpty),
    );

    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isEdit) {
        await client.patch('/fixed-assets/${existing['id']}', body: values);
      } else {
        await client.post('/fixed-assets', body: values);
      }
      await ref.read(fixedAssetsListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _activate(Json asset) async {
    final l10n = context.l10n;
    final accounts = await _accounts();
    if (!mounted) return;
    final values = await showFormSheet(
      context,
      title: l10n.activateAsset,
      fields: [
        FieldSpec(
          'fundingAccountId',
          l10n.fundingAccount,
          kind: FieldKind.select,
          required: true,
          options: _options(accounts),
        ),
        FieldSpec('date', l10n.purchaseDate, kind: FieldKind.date),
      ],
    );
    if (values == null || !mounted) return;
    values.removeWhere(
      (key, value) => value == null || (value is String && value.trim().isEmpty),
    );
    await _act(
      confirm: l10n.confirmActivateAsset,
      title: l10n.activateAsset,
      run: () => ref
          .read(apiClientProvider)
          .post('/fixed-assets/${asset['id']}/activate', body: values),
    );
  }

  Future<void> _dispose(Json asset) async {
    final l10n = context.l10n;
    final accounts = await _accounts();
    if (!mounted) return;
    final values = await showFormSheet(
      context,
      title: l10n.disposeAsset,
      fields: [
        FieldSpec(
          'date',
          l10n.disposalDate,
          kind: FieldKind.date,
          required: true,
        ),
        FieldSpec('proceeds', l10n.disposalProceeds, kind: FieldKind.decimal),
        FieldSpec(
          'proceedsAccountId',
          l10n.proceedsAccount,
          kind: FieldKind.select,
          options: _options(accounts),
        ),
        FieldSpec(
          'gainLossAccountId',
          l10n.gainLossAccount,
          kind: FieldKind.select,
          options: _options(accounts),
        ),
      ],
    );
    if (values == null || !mounted) return;
    values.removeWhere(
      (key, value) => value == null || (value is String && value.trim().isEmpty),
    );
    await _act(
      confirm: l10n.confirmDisposeAsset,
      title: l10n.disposeAsset,
      destructive: true,
      run: () => ref
          .read(apiClientProvider)
          .post('/fixed-assets/${asset['id']}/dispose', body: values),
    );
  }

  Future<void> _showRuns() async {
    final l10n = context.l10n;
    try {
      final body = await ref
          .read(apiClientProvider)
          .get('/fixed-assets/depreciation-runs');
      if (!mounted) return;
      final runs = listOf(body['items']);
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(_t('تشغيلات الإهلاك', 'Depreciation runs')),
          content: SizedBox(
            width: 520,
            child: runs.isEmpty
                ? Text(_t('لا توجد تشغيلات بعد', 'No runs yet'))
                : SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        for (final run in runs)
                          ListTile(
                            dense: true,
                            title: Text(
                              '${text(run, 'runNumber')} · ${text(run, 'period')}',
                            ),
                            subtitle: Text(
                              '${text(run, 'runDate')} · '
                              '${listOf(run['lines']).length} '
                              '${_t('أصل', 'asset(s)')}',
                            ),
                            trailing: Text(
                              formatAmount(asString(run['totalAmount'])),
                            ),
                          ),
                      ],
                    ),
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
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    }
  }

  Future<void> _runDepreciation() async {
    final l10n = context.l10n;
    final now = DateTime.now();
    final current =
        '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}';
    final values = await showFormSheet(
      context,
      title: l10n.runDepreciation,
      fields: [
        FieldSpec('period', l10n.depreciationPeriod, required: true),
      ],
      initial: {'period': current},
    );
    if (values == null || !mounted) return;
    await _act(
      run: () => ref
          .read(apiClientProvider)
          .post('/fixed-assets/depreciation-runs', body: values),
    );
  }

  Future<void> _act({
    String? confirm,
    String? title,
    bool destructive = false,
    required Future<void> Function() run,
  }) async {
    final l10n = context.l10n;
    if (confirm != null) {
      final ok = await confirmAction(
        context,
        title: title ?? '',
        message: confirm,
        confirmLabel: title ?? l10n.confirm,
        destructive: destructive,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      await run();
      await ref.read(fixedAssetsListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      // A refused run says why in the message — already depreciated,
      // closed period — and changed nothing.
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _details(Json asset) async {
    final l10n = context.l10n;
    try {
      final detail = await ref
          .read(apiClientProvider)
          .get('/fixed-assets/${asset['id']}');
      if (!mounted) return;
      final rows = listOf(detail['depreciations']);
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('${text(detail, 'code')} — ${text(detail, 'nameEn')}'),
          content: SizedBox(
            width: 560,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '${l10n.assetCost}: ${formatAmount(asString(detail['cost']))}  •  '
                    '${l10n.accumulatedDepreciation}: ${formatAmount(asString(detail['accumulatedDepreciation']))}  •  '
                    '${l10n.bookValue}: ${formatAmount(asString(detail['bookValue']))}',
                  ),
                  if (text(detail, 'acquisitionEntryNumber').isNotEmpty ||
                      text(detail, 'disposalEntryNumber').isNotEmpty ||
                      text(detail, 'purchaseInvoiceLineId').isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      [
                        if (text(detail, 'acquisitionEntryNumber').isNotEmpty)
                          '${_t('قيد الشراء', 'Acquisition entry')}: ${text(detail, 'acquisitionEntryNumber')}',
                        if (text(detail, 'disposalEntryNumber').isNotEmpty)
                          '${_t('قيد الاستبعاد', 'Disposal entry')}: ${text(detail, 'disposalEntryNumber')}',
                        if (text(detail, 'purchaseInvoiceLineId').isNotEmpty)
                          '${_t('مرتبط بفاتورة شراء', 'From purchase invoice')} ×${formatAmount(asString(detail['purchaseQuantity']))}',
                      ].join('  •  '),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                  const SizedBox(height: 12),
                  Text(
                    l10n.depreciationSchedule,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  if (rows.isEmpty) Text('—'),
                  for (final row in rows)
                    ListTile(
                      dense: true,
                      title: Text(text(row, 'period')),
                      subtitle: Text(
                        '${text(row, 'runNumber')}'
                        '${text(row, 'entryNumber').isEmpty ? '' : ' · ${text(row, 'entryNumber')}'}',
                      ),
                      trailing: Text(
                        '${formatAmount(asString(row['amount']))}  →  ${formatAmount(asString(row['accumulatedAfter']))}',
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(l10n.close),
            ),
          ],
        ),
      );
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    }
  }

  AppTone _toneFor(String status) => switch (status) {
    'ACTIVE' => AppTone.success,
    'DRAFT' => AppTone.warning,
    'DISPOSED' => AppTone.neutral,
    _ => AppTone.info,
  };

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(fixedAssetsListProvider);
    final summary = ref.watch(fixedAssetsSummaryProvider);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return ModuleScaffold(
      title: l10n.fixedAssets,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: l10n.refresh,
            onPressed: _busy
                ? null
                : () => ref.read(fixedAssetsListProvider.notifier).reload(),
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
          OutlinedButton.icon(
            onPressed: _busy ? null : _showRuns,
            icon: const Icon(Icons.history_outlined),
            label: Text(_t('تشغيلات الإهلاك', 'Depreciation runs')),
          ),
          const SizedBox(width: 8),
          OutlinedButton.icon(
            onPressed: _busy ? null : _runDepreciation,
            icon: const Icon(Icons.trending_down_outlined),
            label: Text(l10n.runDepreciation),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: _busy ? null : () => _save(),
            icon: const Icon(Icons.add),
            label: Text(l10n.newAsset),
          ),
        ],
      ),
      body: Column(
        children: [
          summary.maybeWhen(
            data: (data) {
              final totals = data['totals'] is Map
                  ? Map<String, dynamic>.from(data['totals'] as Map)
                  : const <String, dynamic>{};
              return Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Wrap(
                    spacing: 24,
                    children: [
                      Text(
                        '${l10n.assetCost}: ${formatAmount(asString(totals['cost']))}',
                      ),
                      Text(
                        '${l10n.accumulatedDepreciation}: ${formatAmount(asString(totals['accumulatedDepreciation']))}',
                      ),
                      Text(
                        '${l10n.bookValue}: ${formatAmount(asString(totals['bookValue']))}',
                      ),
                    ],
                  ),
                ),
              );
            },
            orElse: () => const SizedBox.shrink(),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      labelText: _t(
                        'بحث بالكود أو الاسم أو الموقع',
                        'Search code, name or location',
                      ),
                      isDense: true,
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.search, size: 18),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 170,
                  child: DropdownButtonFormField<String?>(
                    key: ValueKey(_statusFilter),
                    initialValue: _statusFilter,
                    isDense: true,
                    decoration: InputDecoration(
                      labelText: l10n.status,
                      isDense: true,
                      border: const OutlineInputBorder(),
                    ),
                    items: [
                      DropdownMenuItem<String?>(
                        value: null,
                        child: Text(_t('الكل', 'All')),
                      ),
                      for (final status in const [
                        'DRAFT',
                        'ACTIVE',
                        'FULLY_DEPRECIATED',
                        'DISPOSED',
                      ])
                        DropdownMenuItem<String?>(
                          value: status,
                          child: Text(status),
                        ),
                    ],
                    onChanged: (value) =>
                        setState(() => _statusFilter = value),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 180,
                  child: DropdownButtonFormField<String?>(
                    key: ValueKey(_categoryFilter),
                    initialValue: _categoryFilter,
                    isDense: true,
                    decoration: InputDecoration(
                      labelText: l10n.assetCategory,
                      isDense: true,
                      border: const OutlineInputBorder(),
                    ),
                    items: [
                      DropdownMenuItem<String?>(
                        value: null,
                        child: Text(_t('الكل', 'All')),
                      ),
                      for (final category in {
                        for (final row in async.value ?? const <Json>[])
                          if (text(row, 'category').isNotEmpty)
                            text(row, 'category'),
                      })
                        DropdownMenuItem<String?>(
                          value: category,
                          child: Text(category),
                        ),
                    ],
                    onChanged: (value) =>
                        setState(() => _categoryFilter = value),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: AsyncStateView<List<Json>>(
              value: async,
              onRetry: () =>
                  ref.read(fixedAssetsListProvider.notifier).reload(),
              isEmpty: (rows) => rows.isEmpty,
              emptyMessage: l10n.noAssets,
              data: (rows) {
                final query = _search.text.trim().toLowerCase();
                final visible = rows.where((row) {
                  if (_statusFilter != null &&
                      text(row, 'status') != _statusFilter) {
                    return false;
                  }
                  if (_categoryFilter != null &&
                      text(row, 'category') != _categoryFilter) {
                    return false;
                  }
                  if (query.isEmpty) return true;
                  return text(row, 'code').toLowerCase().contains(query) ||
                      text(row, 'nameEn').toLowerCase().contains(query) ||
                      text(row, 'nameAr').contains(query) ||
                      text(row, 'location').toLowerCase().contains(query);
                }).toList();
                return RecordsTable(
                rows: visible,
                onTap: _details,
                columns: [
                  ColumnSpec(
                    l10n.assetCode,
                    value: (r) => text(r, 'code'),
                    emphasise: true,
                  ),
                  ColumnSpec(
                    isArabic ? l10n.fullNameAr : l10n.fullNameEn,
                    value: (r) => isArabic
                        ? text(r, 'nameAr', fallback: text(r, 'nameEn'))
                        : text(r, 'nameEn', fallback: text(r, 'nameAr')),
                  ),
                  ColumnSpec(
                    l10n.assetCategory,
                    value: (r) => text(r, 'category'),
                  ),
                  ColumnSpec(
                    l10n.inServiceDate,
                    value: (r) => text(r, 'inServiceDate'),
                  ),
                  ColumnSpec(
                    l10n.status,
                    value: (r) => text(r, 'status'),
                    tone: (r) => _toneFor(text(r, 'status')),
                  ),
                  ColumnSpec(
                    l10n.assetCost,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['cost'])),
                  ),
                  ColumnSpec(
                    l10n.salvageValue,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['salvageValue'])),
                  ),
                  ColumnSpec(
                    l10n.usefulLifeMonths,
                    numeric: true,
                    value: (r) => text(r, 'usefulLifeMonths'),
                  ),
                  ColumnSpec(
                    l10n.accumulatedDepreciation,
                    numeric: true,
                    value: (r) =>
                        formatAmount(asString(r['accumulatedDepreciation'])),
                  ),
                  ColumnSpec(
                    l10n.bookValue,
                    numeric: true,
                    emphasise: true,
                    value: (r) => formatAmount(asString(r['bookValue'])),
                  ),
                  ColumnSpec(
                    _t('آخر إهلاك', 'Last depreciation'),
                    value: (r) => text(r, 'lastDepreciationPeriod'),
                  ),
                  ColumnSpec(
                    l10n.assetLocation,
                    value: (r) => text(r, 'location'),
                  ),
                ],
                actions: (row) {
                  final status = text(row, 'status');
                  return [
                    if (status == 'DRAFT')
                      IconButton(
                        tooltip: l10n.edit,
                        icon: const Icon(Icons.edit_outlined, size: 20),
                        onPressed: _busy ? null : () => _save(existing: row),
                      ),
                    if (status == 'DRAFT')
                      IconButton(
                        tooltip: l10n.activateAsset,
                        icon: const Icon(Icons.play_circle_outline, size: 20),
                        onPressed: _busy ? null : () => _activate(row),
                      ),
                    if (status == 'ACTIVE' || status == 'FULLY_DEPRECIATED')
                      IconButton(
                        tooltip: l10n.disposeAsset,
                        icon: const Icon(Icons.outbox_outlined, size: 20),
                        onPressed: _busy ? null : () => _dispose(row),
                      ),
                  ];
                },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
