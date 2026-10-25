import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/discount_math.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/records_table.dart';

/// One receipt or payment with everything behind it: the partner, the box the
/// money moved through, the invoices it settled and the entries it wrote.
///
/// Pure view: it renders the document the server returned and never asks for
/// anything itself, so the screen can show it inside the cash tab and a test
/// can render it from a literal map. The only arithmetic is adding the
/// allocations up, in decimals, so the total always equals their sum.
class VoucherDetailsView extends StatelessWidget {
  const VoucherDetailsView({
    super.key,
    required this.voucher,
    required this.onOpen,
  });

  final Json voucher;

  /// Opens another screen. The owner passes a callback so the navigation
  /// happens on a context that outlives the dialog.
  final void Function(String path) onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final locale = Localizations.localeOf(context).toString();

    final allocations = listOf(voucher['allocations']);
    final entries = listOf(voucher['journalEntries']);
    final draft = text(voucher, 'status').toUpperCase() == 'DRAFT';
    final receipt = text(voucher, 'kind').toUpperCase() == 'RECEIPT';
    final cash = voucher['cashAccount'] is Map
        ? Map<String, dynamic>.from(voucher['cashAccount'] as Map)
        : const <String, dynamic>{};
    final cashLabel = cash.isEmpty
        ? ''
        : '${text(cash, 'code')} — '
              '${arabic ? text(cash, 'nameAr', fallback: text(cash, 'nameEn')) : text(cash, 'nameEn', fallback: text(cash, 'nameAr'))}';
    final notes = text(voucher, 'description');
    final reference = text(voucher, 'reference');

    // The allocations are the voucher's own rows, so their sum is what the
    // money settled. What is left over stayed on the partner's account -
    // shown only when there is some, never as a silent zero.
    final allocated = allocations.fold(
      Decimal.zero,
      (sum, row) => sum + decimalOf(asString(row['amount'])),
    );
    final voucherAmount = decimalOf(asString(voucher['amount']));
    final onAccount = voucherAmount - allocated;
    final hasOnAccount = onAccount > Decimal.zero;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 24,
          runSpacing: 8,
          children: [
            _Fact(label: l10n.invoiceDate, value: text(voucher, 'voucherDate')),
            _Fact(
              label: l10n.voucherType,
              value: receipt ? l10n.receipt : l10n.payment,
            ),
            _Fact(
              label: l10n.party,
              value: partyName(voucher, arabic: arabic),
            ),
            _Fact(
              label: l10n.amount,
              value:
                  '${formatAmount(amount(voucher, 'amount'), locale: locale)} '
                  '${text(voucher, 'currency')}',
            ),
            if (cashLabel.isNotEmpty)
              _Fact(label: l10n.cashAccount, value: cashLabel),
            _Fact(label: l10n.status, value: text(voucher, 'status')),
          ],
        ),
        if (notes.isNotEmpty || reference.isNotEmpty) ...[
          const SizedBox(height: 8),
          if (notes.isNotEmpty) Text('${l10n.description}: $notes'),
          if (reference.isNotEmpty) Text('${l10n.reference}: $reference'),
        ],
        const SizedBox(height: 12),
        Row(
          children: [
            Text(
              arabic ? 'الفواتير المسدَّدة' : 'Invoices settled',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const Spacer(),
            if (allocations.isNotEmpty)
              Text(
                arabic
                    ? 'إجمالي التخصيص ${formatAmount(allocated.toString(), locale: locale)}'
                    : 'Applied ${formatAmount(allocated.toString(), locale: locale)}',
              ),
            if (hasOnAccount) ...[
              const SizedBox(width: 16),
              Text(
                arabic
                    ? 'على الحساب ${formatAmount(onAccount.toString(), locale: locale)}'
                    : 'On account ${formatAmount(onAccount.toString(), locale: locale)}',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 6),
        Expanded(
          child: allocations.isEmpty
              ? Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(
                    arabic
                        ? 'لم تُخصَّص لفواتير: المبلغ كله باقٍ على حساب الطرف.'
                        : 'Not applied to an invoice: the whole amount stays on the party account.',
                  ),
                )
              : RecordsTable(
                  rows: allocations,
                  columns: [
                    ColumnSpec(
                      arabic ? 'الفاتورة' : 'Invoice',
                      value: (row) => text(row, 'invoiceNumber'),
                      emphasise: true,
                    ),
                    ColumnSpec(
                      arabic ? 'إجمالي الفاتورة' : 'Invoice total',
                      numeric: true,
                      value: (row) =>
                          formatAmount(amount(row, 'invoiceTotal'), locale: locale),
                    ),
                    ColumnSpec(
                      l10n.amount,
                      numeric: true,
                      emphasise: true,
                      value: (row) =>
                          formatAmount(amount(row, 'amount'), locale: locale),
                    ),
                  ],
                ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Text(
              arabic ? 'القيد المحاسبي' : 'Journal entry',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const Spacer(),
            TextButton(
              onPressed: () => onOpen(AppRoutes.journalEntries),
              child: Text(arabic ? 'فتح القيود اليومية' : 'Open the journal'),
            ),
            if (allocations.isNotEmpty)
              TextButton(
                onPressed: () => onOpen(
                  receipt ? AppRoutes.salesInvoices : AppRoutes.purchaseInvoices,
                ),
                child: Text(
                  receipt
                      ? (arabic ? 'فتح فواتير البيع' : 'Open sales invoices')
                      : (arabic ? 'فتح فواتير الشراء' : 'Open purchase invoices'),
                ),
              ),
          ],
        ),
        const SizedBox(height: 4),
        if (entries.isEmpty)
          Text(
            draft
                ? (arabic
                      ? 'لا يوجد قيد: السند لم يُرحَّل بعد.'
                      : 'No entry yet: the voucher is still a draft.')
                : (arabic
                      ? 'لا يوجد قيد مرتبط بهذا السند.'
                      : 'No entry is linked to this voucher.'),
          )
        else
          for (final entry in entries)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  Text(
                    text(entry, 'entryNumber'),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(width: 12),
                  Text(text(entry, 'entryDate')),
                  const SizedBox(width: 12),
                  Text(
                    flag(entry, 'isReversal')
                        ? (arabic ? 'قيد عكسي' : 'Reversal')
                        : (arabic ? 'القيد الأصلي' : 'Original'),
                  ),
                  const Spacer(),
                  Text(formatAmount(amount(entry, 'amount'), locale: locale)),
                ],
              ),
            ),
      ],
    );
  }
}

/// A labelled figure in the voucher header.
class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(value, style: theme.textTheme.bodyMedium),
      ],
    );
  }
}
