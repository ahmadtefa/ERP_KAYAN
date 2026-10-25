import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../../shared/widgets/records_table.dart';

/// The partner statement: what they owe, what they paid, and every movement
/// with its running balance - the sheet an accountant would otherwise build
/// by hand at month end.
Future<void> showPartyStatementDialog(
  BuildContext context, {
  required bool isCustomer,
  required Json party,
}) {
  return showDialog<void>(
    context: context,
    builder: (context) => _PartyStatementDialog(
      isCustomer: isCustomer,
      party: party,
    ),
  );
}

class _PartyStatementDialog extends ConsumerStatefulWidget {
  const _PartyStatementDialog({
    required this.isCustomer,
    required this.party,
  });

  final bool isCustomer;
  final Json party;

  @override
  ConsumerState<_PartyStatementDialog> createState() =>
      _PartyStatementDialogState();
}

class _PartyStatementDialogState extends ConsumerState<_PartyStatementDialog> {
  late DateTime _from;
  late DateTime _to;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = DateTime(now.year, 1, 1);
    _to = now;
  }

  String _fmt(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final base = widget.isCustomer
        ? '/parties/customers'
        : '/parties/suppliers';
    final id = widget.party['id'];
    final summaryAsync = ref.watch(
      partySummaryProvider('$base/summary/$id'),
    );
    final statementAsync = ref.watch(
      partyStatementProvider('$base/statement/$id?from=${_fmt(_from)}&to=${_fmt(_to)}'),
    );

    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 30),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1080, maxHeight: 720),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      arabic ? 'كشف حساب' : 'Statement',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                  IconButton(
                    tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${text(widget.party, 'code')} — '
                      '${text(widget.party, 'nameEn')} / '
                      '${text(widget.party, 'nameAr')}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final picked = await showDateRangePicker(
                        context: context,
                        firstDate: DateTime(2000),
                        lastDate: DateTime(DateTime.now().year + 5),
                        initialDateRange: DateTimeRange(
                          start: _from,
                          end: _to,
                        ),
                      );
                      if (picked == null) return;
                      setState(() {
                        _from = picked.start;
                        _to = picked.end;
                      });
                    },
                    icon: const Icon(Icons.date_range_outlined, size: 18),
                    label: Text(
                      arabic ? 'الفترة' : 'Period',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: statementAsync.when(
                loading: () =>
                    const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Text(
                      arabic
                          ? 'تعذر تحميل كشف الحساب.'
                          : 'The statement could not be loaded.',
                    ),
                  ),
                ),
                data: (data) {
                  final rows = listOf(data['rows']);
                  return Column(
                    children: [
                      summaryAsync.when(
                        loading: () => const SizedBox.shrink(),
                        error: (_, _) => const SizedBox.shrink(),
                        data: (summary) {
                          final totals = summary['totals'] is Map
                              ? Map<String, dynamic>.from(
                                  summary['totals'] as Map,
                                )
                              : <String, dynamic>{};
                          // Money the partner left on account is not owed on
                          // any document, so it only appears when there is
                          // some; the balance then has to be the net one,
                          // which is the figure the control account carries.
                          final onAccount = amount(totals, 'onAccount');
                          final showsOnAccount = onAccount != '0.0000';
                          return Padding(
                            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                            child: Wrap(
                              spacing: 18,
                              runSpacing: 6,
                              children: [
                                _chip(
                                  context,
                                  arabic ? 'إجمالي الفواتير' : 'Invoiced',
                                  formatAmount(asString(totals['invoiced'])),
                                ),
                                _chip(
                                  context,
                                  arabic ? 'المسدَّد' : 'Paid',
                                  formatAmount(asString(totals['paid'])),
                                ),
                                if (showsOnAccount)
                                  _chip(
                                    context,
                                    arabic ? 'على الحساب' : 'On account',
                                    formatAmount(onAccount),
                                  ),
                                _chip(
                                  context,
                                  arabic ? 'الرصيد' : 'Balance',
                                  formatAmount(
                                    showsOnAccount
                                        ? amount(totals, 'netBalance')
                                        : asString(totals['outstanding']),
                                  ),
                                ),
                                _chip(
                                  context,
                                  arabic ? 'المتأخر' : 'Overdue',
                                  formatAmount(asString(totals['overdue'])),
                                ),
                                _chip(
                                  context,
                                  arabic ? 'عدد الفواتير' : 'Invoices',
                                  '${totals['invoices'] ?? 0}',
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Row(
                          children: [
                            Text(
                              '${arabic ? 'رصيد افتتاحي' : 'Opening'}: '
                              '${formatAmount(asString(data['openingBalance']))}',
                            ),
                            const Spacer(),
                            Text(
                              '${arabic ? 'رصيد ختامي' : 'Closing'}: '
                              '${formatAmount(asString(data['closingBalance']))}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 8),
                      Expanded(
                        child: rows.isEmpty
                            ? Center(
                                child: Text(
                                  arabic
                                      ? 'لا توجد حركات في هذه الفترة.'
                                      : 'No movements in this period.',
                                ),
                              )
                            : RecordsTable(
                                rows: rows,
                                columns: [
                                  ColumnSpec(
                                    arabic ? 'التاريخ' : 'Date',
                                    value: (r) => text(r, 'date'),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'المستند' : 'Document',
                                    value: (r) => text(r, 'number'),
                                    emphasise: true,
                                  ),
                                  ColumnSpec(
                                    arabic ? 'النوع' : 'Kind',
                                    value: (r) => text(r, 'type'),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'البيان' : 'Description',
                                    value: (r) => text(r, 'description'),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'مدين' : 'Debit',
                                    numeric: true,
                                    value: (r) =>
                                        formatAmount(asString(r['debit'])),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'دائن' : 'Credit',
                                    numeric: true,
                                    value: (r) =>
                                        formatAmount(asString(r['credit'])),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'الرصيد' : 'Balance',
                                    numeric: true,
                                    value: (r) =>
                                        formatAmount(asString(r['balance'])),
                                    emphasise: true,
                                  ),
                                ],
                              ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(BuildContext context, String label, String value) => Text(
        '$label: $value',
        style: Theme.of(context)
            .textTheme
            .bodyMedium
            ?.copyWith(fontWeight: FontWeight.w700),
      );
}

final partySummaryProvider =
    FutureProvider.family<Json, String>((ref, path) async {
  return ref.read(apiClientProvider).getObject(path);
});

final partyStatementProvider =
    FutureProvider.family<Json, String>((ref, path) async {
  return ref.read(apiClientProvider).getObject(path);
});
