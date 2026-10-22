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
                      subtitle: Text(text(row, 'runNumber')),
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
          Expanded(
            child: AsyncStateView<List<Json>>(
              value: async,
              onRetry: () =>
                  ref.read(fixedAssetsListProvider.notifier).reload(),
              isEmpty: (rows) => rows.isEmpty,
              emptyMessage: l10n.noAssets,
              data: (rows) => RecordsTable(
                rows: rows,
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
              ),
            ),
          ),
        ],
      ),
    );
  }
}
