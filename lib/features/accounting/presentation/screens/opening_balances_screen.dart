import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../dashboard/presentation/providers/dashboard_providers.dart';
import 'journal_entries_screen.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../../../inventory/presentation/screens/stock_screen.dart';

/// Lists imported opening-balance drafts and gives the accountant a review
/// screen before posting them to the ledger and stock.
class OpeningBalancesScreen extends ConsumerStatefulWidget {
  const OpeningBalancesScreen({super.key, this.documentId});

  final String? documentId;

  @override
  ConsumerState<OpeningBalancesScreen> createState() =>
      _OpeningBalancesScreenState();
}

class _OpeningBalancesScreenState extends ConsumerState<OpeningBalancesScreen> {
  late Future<Map<String, dynamic>> _load;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load = _fetch();
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
    return client.getObject('/accounting/opening-balances').then((value) => value);
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
        ref.invalidate(journalEntriesProvider);
        invalidateDashboardAndReports(ref);
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _manualEntry() async {
    final api = ref.read(apiClientProvider);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final date = TextEditingController(text: DateTime.now().toIso8601String().substring(0, 10));
    final amounts = <TextEditingController>[TextEditingController()];
    final selectedAccounts = <String?>[null];
    String? balancingAccount;
    try {
      final responses = await Future.wait([
        api.getObject('/accounting/chart-of-accounts'),
        api.getObject('/cash/accounts'),
      ]);
      final accounts = (responses[0]['items'] as List? ?? const [])
          .whereType<Map>().map(Map<String, dynamic>.from)
          .where((a) => a['isPostable'] == true && a['isActive'] != false)
          .toList();
      final cashAccounts = (responses[1]['items'] as List? ?? const [])
          .whereType<Map>().map(Map<String, dynamic>.from)
          .where((a) => a['isActive'] != false && a['accountId'] != null)
          .toList();
      if (!mounted) return;
      if (cashAccounts.isEmpty || accounts.isEmpty) {
        showMessage(context, arabic ? 'أضف حساب بنك أو خزنة وحسابًا محاسبيًا أولًا' : 'Create a bank or cash account and ledger account first', error: true);
        return;
      }
      String label(Map<String, dynamic> a) {
        final preferred = (a[arabic ? 'nameAr' : 'nameEn'] ?? '').toString().trim();
        final fallback = (a[arabic ? 'nameEn' : 'nameAr'] ?? '').toString().trim();
        return '${a['code'] ?? ''} - ${preferred.isNotEmpty ? preferred : fallback}';
      }
      final saved = await showDialog<bool>(
        context: context,
        builder: (ctx) => StatefulBuilder(
          builder: (ctx, update) => AlertDialog(
            title: Text(arabic ? 'الأرصدة الافتتاحية للبنوك والخزائن' : 'Bank and cash opening balances'),
            content: SizedBox(
              width: 550,
              child: SingleChildScrollView(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  for (var i = 0; i < amounts.length; i++) ...[
                    Row(children: [
                      Expanded(
                        flex: 3,
                        child: DropdownButtonFormField<String>(
                          key: ValueKey('cash-account-$i'),
                          isExpanded: true,
                          initialValue: selectedAccounts[i],
                          decoration: InputDecoration(labelText: arabic ? 'البنك / الخزنة' : 'Bank / cash'),
                          items: cashAccounts.map((a) => DropdownMenuItem<String>(
                            value: a['accountId'].toString(),
                            child: Text(label(a), overflow: TextOverflow.ellipsis),
                          )).toList(),
                          onChanged: (v) => update(() => selectedAccounts[i] = v),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: amounts[i],
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: InputDecoration(labelText: arabic ? 'الرصيد' : 'Balance'),
                        ),
                      ),
                      IconButton(
                        tooltip: arabic ? 'حذف السطر' : 'Remove row',
                        onPressed: amounts.length <= 1 ? null : () => update(() {
                          selectedAccounts.removeAt(i);
                          amounts.removeAt(i).dispose();
                        }),
                        icon: const Icon(Icons.remove_circle_outline),
                      ),
                    ]),
                  ],
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton.icon(
                      onPressed: () => update(() {
                        selectedAccounts.add(null);
                        amounts.add(TextEditingController());
                      }),
                      icon: const Icon(Icons.add),
                      label: Text(arabic ? 'إضافة بنك أو خزنة' : 'Add bank or cash'),
                    ),
                  ),
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    initialValue: balancingAccount,
                    decoration: InputDecoration(labelText: arabic ? 'الحساب المقابل للأرصدة' : 'Balancing account'),
                    items: accounts.map((a) => DropdownMenuItem<String>(
                      value: a['id'].toString(),
                      child: Text(label(a), overflow: TextOverflow.ellipsis),
                    )).toList(),
                    onChanged: (v) => update(() => balancingAccount = v),
                  ),
                  TextField(controller: date, decoration: InputDecoration(
                    labelText: arabic ? 'تاريخ الأرصدة (YYYY-MM-DD)' : 'Opening date (YYYY-MM-DD)')),
                ]),
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false),
                child: Text(arabic ? 'إلغاء' : 'Cancel')),
              FilledButton(
                onPressed: () async {
                  final ids = selectedAccounts.whereType<String>().toList();
                  final entered = amounts.map((a) => a.text.trim()).toList();
                  final amountPattern = RegExp(r'^\d+(?:\.\d{1,4})?$');
                  final dateText = date.text.trim();
                  final parsedDate = DateTime.tryParse(dateText);
                  final valid = ids.length == amounts.length &&
                      ids.toSet().length == ids.length &&
                      balancingAccount != null &&
                      !ids.contains(balancingAccount) &&
                      entered.every((value) => amountPattern.hasMatch(value) &&
                          BigInt.parse(value.replaceAll('.', '')) > BigInt.zero) &&
                      parsedDate != null &&
                      parsedDate.toIso8601String().substring(0, 10) == dateText;
                  if (!valid) {
                    showMessage(ctx, arabic ? 'راجع الحسابات والمبالغ والتاريخ، ولا تكرر الحساب' : 'Check accounts, positive balances, duplicates and date', error: true);
                    return;
                  }
                  try {
                    final totalMinor = entered.fold<BigInt>(BigInt.zero, (sum, value) {
                      final parts = value.split('.');
                      final fractional = parts.length == 2 ? parts[1].padRight(4, '0') : '0000';
                      return sum + BigInt.parse(parts[0]) * BigInt.from(10000) +
                          BigInt.parse(fractional);
                    });
                    final total = '${totalMinor ~/ BigInt.from(10000)}.${(totalMinor % BigInt.from(10000)).toString().padLeft(4, '0')}';
                    await api.post('/accounting/opening-balances', body: {
                      'asOfDate': date.text.trim(),
                      'description': arabic ? 'أرصدة بنوك وخزائن افتتاحية' : 'Opening bank and cash balances',
                      'lines': [
                        for (var i = 0; i < ids.length; i++)
                          {'accountId': ids[i], 'debit': amounts[i].text.trim(), 'credit': '0'},
                        {'accountId': balancingAccount, 'debit': '0', 'credit': total},
                      ],
                    });
                    if (ctx.mounted) Navigator.pop(ctx, true);
                  } catch (e) {
                    if (ctx.mounted) showMessage(ctx, e, error: true);
                  }
                },
                child: Text(arabic ? 'حفظ مسودة للمراجعة' : 'Save draft for review'),
              ),
            ],
          ),
        ),
      );
      if (saved == true && mounted) _refresh();
    } catch (e) {
      if (mounted) showMessage(context, e, error: true);
    } finally {
      date.dispose();
      for (final controller in amounts) {
        controller.dispose();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final isDetail = widget.documentId != null;

    return ModuleScaffold(
      title: l10n.openingBalancesTitle,
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (!isDetail)
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
                ref.read(reportLinkProvider).importTemplate(
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
                      label: Text(_statusLabel(context, '${row['status'] ?? ''}')),
                    ),
                    onTap: () => context.go(
                      '/accounting/opening-balances/${row['id']}',
                    ),
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
                if (data['description'] != null && '${data['description']}'.isNotEmpty)
                  Text('${l10n.description}: ${data['description']}'),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    _total(context, l10n.debit, '${data['totalDebit'] ?? '0'}'),
                    _total(context, l10n.credit, '${data['totalCredit'] ?? '0'}'),
                  ],
                ),
                if (status == 'draft') ...[
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: _busy ? null : () => _post('${data['id']}'),
                    icon: const Icon(Icons.publish_outlined),
                    label: Text(_busy ? l10n.posting : l10n.post),
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
                '${l10n.debit}: ${line['debit'] ?? '0'} · '
                '${l10n.credit}: ${line['credit'] ?? '0'}'
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
