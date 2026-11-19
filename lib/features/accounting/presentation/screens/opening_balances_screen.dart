import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../cash/presentation/providers/cash_providers.dart';
import 'opening_balance_draft_dialog.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../../../inventory/presentation/screens/stock_screen.dart';

/// Lists imported opening-balance drafts and gives the accountant a review
/// screen before posting them to the ledger and stock.
class OpeningBalancesScreen extends ConsumerStatefulWidget {
  const OpeningBalancesScreen({super.key, this.documentId, this.navigationKey});

  final String? documentId;
  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<OpeningBalancesScreen> createState() =>
      _OpeningBalancesScreenState();
}

class _OpeningBalancesScreenState extends ConsumerState<OpeningBalancesScreen> {
  late Future<Map<String, dynamic>> _load;
  bool _busy = false;
  final _exitRelay = DraftExitRelay();
  late final DraftExitGuard _exitGuard;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
    _exitGuard = ref.read(draftExitGuardProvider);
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _exitRelay.canLeave);
  }

  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _exitRelay.canLeave);
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant OpeningBalancesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.documentId != widget.documentId) _refresh();
  }

  Future<Map<String, dynamic>> _fetch() {
    final client = ref.read(apiClientProvider);
    final id = widget.documentId;
    if (id != null) return client.getObject('/accounting/opening-balances/$id');
    return client
        .getObject('/accounting/opening-balances')
        .then((value) => value);
  }

  void _refresh() {
    setState(() {
      _load = _fetch();
    });
  }

  Future<void> _post(String id) async {
    final l10n = context.l10n;
    final confirmed = await confirmAction(
      context,
      title: l10n.post,
      message: l10n.confirmPost,
      confirmLabel: l10n.post,
    );
    if (!confirmed || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('/accounting/opening-balances/$id/post');
      if (mounted) showMessage(context, l10n.entryPosted);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) {
        // A failed response can arrive after the server committed the post.
        // Reload the document and all dependent ledger/stock/dashboard views.
        _refresh();
        ref.invalidate(stockListProvider);
        invalidateMoneyViews(ref);
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _manualEntry([Map<String, dynamic>? draft]) async {
    if (_busy) return;
    final user = ref.read(currentUserProvider);
    if (user == null) return;
    setState(() => _busy = true);
    try {
      final saved = await showOpeningBalanceDraft(
        context,
        ref.read(apiClientProvider),
        user,
        draft: draft,
        exitRelay: _exitRelay,
      );
      if (saved == true && mounted) _refresh();
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeDocument(String id, {required bool reverse}) async {
    if (_busy) return;
    final l10n = context.l10n;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final title = reverse
        ? l10n.reverse
        : (arabic ? 'حذف المسودة' : 'Delete draft');
    final confirmed = await confirmAction(
      context,
      title: title,
      message: reverse
          ? (arabic
                ? 'عكس القيد وحركات المخزون؟'
                : 'Reverse the journal and stock movements?')
          : (arabic
                ? 'حذف مسودة الأرصدة الافتتاحية؟'
                : 'Delete this opening balance draft?'),
      confirmLabel: title,
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    setState(() => _busy = true);
    final api = ref.read(apiClientProvider);
    final path = '/accounting/opening-balances/$id';
    try {
      if (reverse) {
        await api.post('$path/reverse');
      } else {
        await api.delete(path);
        if (mounted) context.go('/accounting/opening-balances');
      }
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) {
        _refresh();
        if (reverse) {
          ref.invalidate(stockListProvider);
          invalidateMoneyViews(ref);
        }
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final isDetail = widget.documentId != null;
    final user = ref.watch(currentUserProvider);
    final canCreate =
        user?.can('accounting.openingbalances.manage') == true &&
        user?.can('accounting.accounts.read') == true;

    return ModuleScaffold(
      title: l10n.openingBalancesTitle,
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (!isDetail && canCreate)
            FilledButton.icon(
              onPressed: _busy ? null : _manualEntry,
              icon: const Icon(Icons.add),
              label: Text(isArabic ? 'إدخال يدوي' : 'Manual entry'),
            ),
          // The blank workbook first: it is the file this screen's documents
          // come from, so it can be fetched from here without hunting for
          // the import screen and the right entry in its list.
          if (!isDetail)
            OutlinedButton.icon(
              onPressed: () => runDownload(
                context,
                ref
                    .read(reportLinkProvider)
                    .importTemplate(
                      kind: 'opening-balances',
                      language: Localizations.localeOf(context).languageCode,
                    ),
              ),
              icon: const Icon(Icons.download_outlined),
              label: Text(l10n.downloadTemplate),
            ),
          if (!isDetail)
            OutlinedButton.icon(
              onPressed: () => context.go('/data/import'),
              icon: const Icon(Icons.upload_file_outlined),
              label: Text(l10n.importData),
            ),
          IconButton(
            tooltip: l10n.refresh,
            onPressed: _busy ? null : _refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _load,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(describeError(context, snapshot.error!)),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _refresh,
                    icon: const Icon(Icons.refresh),
                    label: Text(l10n.retry),
                  ),
                ],
              ),
            );
          }

          final data = snapshot.data ?? const <String, dynamic>{};
          if (isDetail) {
            return _detail(data, isArabic: isArabic);
          }
          final items = (data['items'] as List? ?? const [])
              .whereType<Map>()
              .map(Map<String, dynamic>.from)
              .toList(growable: false);
          if (items.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.account_balance_outlined, size: 40),
                    const SizedBox(height: 12),
                    Text(l10n.noOpeningBalanceDocuments),
                    const SizedBox(height: 8),
                    Text(
                      l10n.openingBalanceDraftHint,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            );
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(l10n.openingBalanceDraftHint),
              ),
              for (final row in items)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.account_balance_wallet_outlined),
                    title: Text('${row['documentNumber'] ?? ''}'),
                    subtitle: Text(
                      '${l10n.invoiceDate}: ${row['asOfDate'] ?? ''} · '
                      '${_localized(row['branch'], isArabic, 'nameEn', 'nameAr') ?? (row['branch'] is Map ? (row['branch'] as Map)['code'] : '')}',
                    ),
                    trailing: Chip(
                      label: Text(
                        _statusLabel(context, '${row['status'] ?? ''}'),
                      ),
                    ),
                    onTap: () =>
                        context.go('/accounting/opening-balances/${row['id']}'),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _detail(Map<String, dynamic> data, {required bool isArabic}) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final status = '${data['status'] ?? ''}'.toLowerCase();
    final user = ref.watch(currentUserProvider);
    final mayManage =
        data['hasRestrictedCosts'] != true &&
        user?.can('accounting.openingbalances.manage') == true &&
        (user?.isSuperAdmin == true || user?.branchId == data['branchId']);
    final id = '${data['id']}';
    final branch = data['branch'];
    final warehouse = data['warehouse'];
    final lines = (data['lines'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList(growable: false);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${data['documentNumber'] ?? ''}',
                        style: theme.textTheme.titleLarge,
                      ),
                    ),
                    Chip(label: Text(_statusLabel(context, status))),
                  ],
                ),
                const SizedBox(height: 8),
                Text('${l10n.invoiceDate}: ${data['asOfDate'] ?? ''}'),
                if (branch is Map)
                  Text(
                    '${l10n.branch}: ${_localized(branch, isArabic, 'nameEn', 'nameAr') ?? branch['code'] ?? ''}',
                  ),
                if (warehouse is Map)
                  Text(
                    '${l10n.warehouse}: ${_localized(warehouse, isArabic, 'nameEn', 'nameAr') ?? warehouse['code'] ?? ''}',
                  ),
                if (data['description'] != null &&
                    '${data['description']}'.isNotEmpty)
                  Text('${l10n.description}: ${data['description']}'),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    _total(context, l10n.debit, '${data['totalDebit'] ?? '—'}'),
                    _total(
                      context,
                      l10n.credit,
                      '${data['totalCredit'] ?? '—'}',
                    ),
                  ],
                ),
                if (mayManage && (status == 'draft' || status == 'posted')) ...[
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (status == 'draft') ...[
                        FilledButton.icon(
                          onPressed: _busy ? null : () => _post(id),
                          icon: const Icon(Icons.publish_outlined),
                          label: Text(_busy ? l10n.posting : l10n.post),
                        ),
                        if (user?.can('accounting.accounts.read') == true)
                          OutlinedButton(
                            onPressed: _busy ? null : () => _manualEntry(data),
                            child: Text(l10n.edit),
                          ),
                        OutlinedButton(
                          onPressed: _busy
                              ? null
                              : () => _changeDocument(id, reverse: false),
                          child: Text(
                            isArabic ? 'حذف المسودة' : 'Delete draft',
                          ),
                        ),
                      ] else
                        OutlinedButton(
                          onPressed: _busy
                              ? null
                              : () => _changeDocument(id, reverse: true),
                          child: Text(l10n.reverse),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(l10n.lines, style: theme.textTheme.titleMedium),
        for (final line in lines)
          Card(
            child: ListTile(
              title: Text(
                '${line['accountCode'] ?? ''}  '
                '${isArabic ? line['accountNameAr'] ?? line['accountNameEn'] ?? '' : line['accountNameEn'] ?? line['accountNameAr'] ?? ''}',
              ),
              subtitle: Text(
                '${l10n.debit}: ${line['debit'] ?? '—'} · '
                '${l10n.credit}: ${line['credit'] ?? '—'}'
                '${line['item'] is Map ? ' · ${(line['item'] as Map)['code'] ?? ''}' : ''}'
                '${line['customer'] is Map ? ' · ${(line['customer'] as Map)['code'] ?? ''}' : ''}'
                '${line['supplier'] is Map ? ' · ${(line['supplier'] as Map)['code'] ?? ''}' : ''}',
              ),
              isThreeLine: false,
            ),
          ),
      ],
    );
  }

  Widget _total(BuildContext context, String label, String amount) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          Text(amount, style: Theme.of(context).textTheme.titleMedium),
        ],
      ),
    );
  }

  String _statusLabel(BuildContext context, String status) {
    final l10n = context.l10n;
    return switch (status.toLowerCase()) {
      'draft' => l10n.draft,
      'posted' => l10n.posted,
      'reversed' => l10n.reversed,
      _ => status,
    };
  }

  String? _localized(
    Object? value,
    bool isArabic,
    String englishKey,
    String arabicKey,
  ) {
    if (value is! Map) return null;
    final preferred = value[isArabic ? arabicKey : englishKey];
    final fallback = value[isArabic ? englishKey : arabicKey];
    final text = preferred ?? fallback;
    return text == null ? null : '$text';
  }
}
