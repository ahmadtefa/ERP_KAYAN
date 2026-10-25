import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/status_pill.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../accounting/presentation/providers/cost_center_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';
import '../../../data/presentation/widgets/document_export_actions.dart';
import '../providers/cash_providers.dart';

/// Cash boxes, bank accounts, receipts, payments and transfers.
///
/// Three lists that belong together: where the money sits, what came in and
/// went out, and what moved between them. Every one of them is posted by the
/// server: this screen never computes a balance, it reports the one the ledger
/// holds. A box is bound to a ledger account, so "how much is in the safe?"
/// has exactly one answer.
class CashScreen extends ConsumerStatefulWidget {
  const CashScreen({super.key});

  @override
  ConsumerState<CashScreen> createState() => _CashScreenState();
}

class _CashScreenState extends ConsumerState<CashScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  bool _busy = false;

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  void _reloadAll() {
    ref.invalidate(cashAccountsProvider);
    ref.invalidate(cashBalancesProvider);
    ref.invalidate(cashVouchersProvider);
    ref.invalidate(cashTransfersProvider);
  }

  /// Everything thrown is shown as the server worded it, never as a stack.
  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } catch (error, stackTrace) {
      // A malformed response or an unexpected client exception must never
      // leave an action looking as if it succeeded.
      debugPrint('Cash action failed: $error\\n$stackTrace');
      if (mounted) {
        showMessage(
          context,
          context.l10n.unexpectedError,
          error: true,
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _newAccount() async {
    final l10n = context.l10n;
    setState(() => _busy = true);
    List<Json> accounts;
    try {
      accounts = await ref
          .read(apiClientProvider)
          .getList('/accounting/chart-of-accounts');
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
      return;
    } catch (error, stackTrace) {
      debugPrint('Loading ledger accounts failed: $error\\n$stackTrace');
      if (mounted) {
        showMessage(context, context.l10n.unexpectedError, error: true);
      }
      return;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    final postable = accounts
        .where((row) => flag(row, 'isPostable', fallback: true))
        .toList(growable: false);
    if (!mounted || postable.isEmpty) return;

    final values = await showFormSheet(
      context,
      title: l10n.newCashAccount,
      fields: [
        FieldSpec('code', l10n.accountCode, required: true),
        FieldSpec('nameEn', l10n.fullNameEn, required: true),
        FieldSpec('nameAr', l10n.fullNameAr, required: true),
        FieldSpec(
          'kind',
          l10n.voucherType,
          kind: FieldKind.select,
          options: [
            FieldOption('CASH', l10n.cashBox),
            FieldOption('BANK', l10n.bank),
          ],
        ),
        FieldSpec(
          'accountId',
          l10n.ledgerAccount,
          kind: FieldKind.select,
          required: true,
          options: [
            for (final account in postable)
              FieldOption(
                text(account, 'id'),
                '${text(account, 'code')} — ${text(account, 'nameEn')}',
              ),
          ],
        ),
        FieldSpec('bankName', l10n.bankName),
        FieldSpec('iban', l10n.iban),
      ],
    );
    if (values == null || !mounted) return;

    await _run(() async {
      await ref.read(apiClientProvider).post('/cash/accounts', body: values);
      _reloadAll();
      if (mounted) showMessage(context, l10n.saved);
    });
  }

  Future<void> _newVoucher() async {
    final l10n = context.l10n;
    List<Json> accounts;
    try {
      accounts = await ref.read(cashAccountsProvider.future);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
      return;
    } catch (error, stackTrace) {
      debugPrint('Loading cash accounts for voucher failed: $error\\n$stackTrace');
      if (mounted) showMessage(context, l10n.unexpectedError, error: true);
      return;
    }
    if (!mounted) return;
    if (accounts.isEmpty) {
      showMessage(context, l10n.noCashAccounts, error: true);
      return;
    }

    final kindValues = await showFormSheet(
      context,
      title: l10n.newVoucher,
      fields: [
        FieldSpec(
          'kind',
          l10n.voucherType,
          kind: FieldKind.select,
          options: [
            FieldOption('RECEIPT', l10n.receipt),
            FieldOption('PAYMENT', l10n.payment),
          ],
        ),
      ],
    );
    if (kindValues == null || !mounted) return;
    final isReceipt = text(kindValues, 'kind') == 'RECEIPT';

    // A payment's expense side is somebody's cost; a receipt's counter side
    // can be somebody's revenue. The picker is optional, because a transfer
    // between the company's own accounts has no owner.
    List<Json> costCenters = const <Json>[];
    try {
      costCenters = await ref.read(activeCostCentersProvider.future);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    }
    if (!mounted) return;

    List<Json> parties = const <Json>[];
    try {
      parties = isReceipt
          ? await ref.read(activeCustomersProvider.future)
          : await ref.read(activeSuppliersProvider.future);
    } on Failure catch (error) {
      // A party is optional for an on-account voucher. Keep the workflow
      // available if this auxiliary picker cannot load.
      if (mounted) showMessage(context, error.message, error: true);
    } catch (error, stackTrace) {
      debugPrint('Loading voucher parties failed: $error\\n$stackTrace');
      if (mounted) {
        showMessage(context, l10n.unexpectedError, error: true);
      }
    }
    if (!mounted) return;

    final values = await showFormSheet(
      context,
      title: isReceipt ? l10n.receipt : l10n.payment,
      fields: [
        FieldSpec(
          'cashAccountId',
          l10n.cashAccount,
          kind: FieldKind.select,
          required: true,
          options: [
            for (final account in accounts)
              FieldOption(
                text(account, 'id'),
                '${text(account, 'code')} — ${text(account, 'nameEn')}',
              ),
          ],
        ),
        if (parties.isNotEmpty)
          FieldSpec(
            isReceipt ? 'customerId' : 'supplierId',
            isReceipt ? l10n.customer : l10n.supplier,
            kind: FieldKind.select,
            options: [
              for (final party in parties)
                FieldOption(
                  text(party, 'id'),
                  '${text(party, 'code')} — ${text(party, 'nameEn')}',
                ),
            ],
          ),
        FieldSpec(
          'voucherDate',
          l10n.invoiceDate,
          kind: FieldKind.date,
          required: true,
        ),
        FieldSpec(
          'amount',
          l10n.amount,
          kind: FieldKind.decimal,
          required: true,
          helper: l10n.settleOldestFirst,
        ),
        if (costCenters.isNotEmpty)
          FieldSpec(
            'costCenterId',
            l10n.costCenter,
            kind: FieldKind.select,
            options: [
              FieldOption('', l10n.noAllocation),
              for (final center in costCenters)
                FieldOption(
                  text(center, 'id'),
                  costCenterLabel(
                    center,
                    Localizations.localeOf(context).languageCode,
                  ),
                ),
            ],
          ),
        FieldSpec('description', l10n.description, maxLines: 2),
      ],
      initial: {
        'voucherDate': DateTime.now().toIso8601String().substring(0, 10),
      },
    );
    if (values == null || !mounted) return;

    // What is still open for this party, oldest first: money is applied to the
    // oldest debt unless somebody says otherwise, and the screen says so.
    final partyId = text(values, isReceipt ? 'customerId' : 'supplierId');
    var allocations = const <Json>[];
    var allocationLookupFailed = false;
    if (partyId.isNotEmpty) {
      setState(() => _busy = true);
      try {
        final open = await ref.read(
          openInvoicesProvider((
            kind: isReceipt ? 'customer' : 'supplier',
            partyId: partyId,
          )).future,
        );
        var left = double.tryParse(text(values, 'amount', fallback: '0')) ?? 0;
        for (final invoice in open) {
          if (left <= 0) break;
          final due = double.tryParse(amount(invoice, 'balance')) ?? 0;
          if (due <= 0) continue;
          final applied = due < left ? due : left;
          allocations = [
            ...allocations,
            {
              if (isReceipt) 'salesInvoiceId': text(invoice, 'id')
              else 'purchaseInvoiceId': text(invoice, 'id'),
              'amount': applied.toStringAsFixed(4),
            },
          ];
          left -= applied;
        }
      } on Failure catch (error) {
        allocationLookupFailed = true;
        if (mounted) showMessage(context, error.message, error: true);
      } catch (error, stackTrace) {
        allocationLookupFailed = true;
        debugPrint('Loading open invoices failed: $error\\n$stackTrace');
        if (mounted) {
          showMessage(context, l10n.unexpectedError, error: true);
        }
      } finally {
        if (mounted) setState(() => _busy = false);
      }
      if (!mounted || allocationLookupFailed) return;
    }

    final body = <String, dynamic>{
      ...values,
      'kind': isReceipt ? 'RECEIPT' : 'PAYMENT',
    };
    if (allocations.isNotEmpty) {
      body['allocations'] = allocations;
    } else if (partyId.isNotEmpty) {
      // Nothing open to settle: the money is carried on account, which is only
      // allowed when the voucher names the party it belongs to.
      body[isReceipt ? 'customerId' : 'supplierId'] = partyId;
    }

    await _run(() async {
      await ref.read(apiClientProvider).post('/cash/vouchers', body: body);
      _reloadAll();
      if (mounted) showMessage(context, l10n.saved);
    });
  }

  Future<void> _newTransfer() async {
    final l10n = context.l10n;
    List<Json> accounts;
    try {
      accounts = await ref.read(cashAccountsProvider.future);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
      return;
    } catch (error, stackTrace) {
      debugPrint('Loading cash accounts for transfer failed: $error\\n$stackTrace');
      if (mounted) showMessage(context, l10n.unexpectedError, error: true);
      return;
    }
    if (!mounted) return;
    if (accounts.length < 2) {
      showMessage(context, l10n.transferNeedsTwoAccounts, error: true);
      return;
    }

    final values = await showFormSheet(
      context,
      title: l10n.newTransfer,
      fields: [
        FieldSpec(
          'fromCashAccountId',
          l10n.fromAccount,
          kind: FieldKind.select,
          required: true,
          options: [
            for (final account in accounts)
              FieldOption(
                text(account, 'id'),
                '${text(account, 'code')} — ${text(account, 'nameEn')}',
              ),
          ],
        ),
        FieldSpec(
          'toCashAccountId',
          l10n.toAccount,
          kind: FieldKind.select,
          required: true,
          options: [
            for (final account in accounts)
              FieldOption(
                text(account, 'id'),
                '${text(account, 'code')} — ${text(account, 'nameEn')}',
              ),
          ],
        ),
        FieldSpec('transferDate', l10n.invoiceDate, kind: FieldKind.date, required: true),
        FieldSpec('amount', l10n.amount, kind: FieldKind.decimal, required: true),
        FieldSpec('description', l10n.description, maxLines: 2),
      ],
      initial: {
        'transferDate': DateTime.now().toIso8601String().substring(0, 10),
      },
    );
    if (values == null || !mounted) return;

    await _run(() async {
      await ref.read(apiClientProvider).post('/cash/transfers', body: values);
      _reloadAll();
      if (mounted) showMessage(context, l10n.saved);
    });
  }

  Future<void> _post(String path, String confirmMessage, String done) async {
    final ok = await confirmAction(
      context,
      title: context.l10n.post,
      message: confirmMessage,
      confirmLabel: context.l10n.post,
    );
    if (!ok || !mounted) return;
    await _run(() async {
      await ref.read(apiClientProvider).post(path);
      _reloadAll();
      if (mounted) showMessage(context, done);
    });
  }

  Future<void> _reverse(String path) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.reverse,
      message: l10n.confirmReverse,
      confirmLabel: l10n.reverse,
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run(() async {
      await ref.read(apiClientProvider).post(path);
      _reloadAll();
      if (mounted) showMessage(context, l10n.entryReversed);
    });
  }

  void _showStatement(Json account) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('${text(account, 'code')} — ${text(account, 'nameEn')}'),
        content: SizedBox(
          width: 640,
          height: 420,
          child: _AccountStatement(
            cashAccountId: text(account, 'id'),
            locale: Localizations.localeOf(context).toString(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(context.l10n.close),
          ),
        ],
      ),
    );
  }

  /// The chain behind one row: what the voucher settled and which entry it
  /// wrote. Opened from the list, read from the server, never recomputed here.
  void _showVoucher(Json voucher) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(text(voucher, 'voucherNumber')),
        content: SizedBox(
          width: 720,
          height: 480,
          child: _VoucherDetails(id: text(voucher, 'id')),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(context.l10n.close),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return ModuleScaffold(
      title: l10n.cashAndBanks,
      trailing: _busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : null,
      body: Column(
        children: [
          TabBar(
            controller: _tabs,
            tabs: [
              Tab(text: l10n.cashAndBanks),
              Tab(text: l10n.vouchers),
              Tab(text: l10n.transfers),
            ],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [_accountsTab(), _vouchersTab(), _transfersTab()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _accountsTab() {
    final l10n = context.l10n;
    final accounts = ref.watch(cashAccountsProvider);
    final balances = ref.watch(cashBalancesProvider);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final balanceByCode = {
      for (final row in balances.value ?? const <Json>[]) text(row, 'code'): row,
    };

    return Column(
      children: [
        if (balances.hasError)
          MaterialBanner(
            content: Text(
              balances.error is Failure
                  ? (balances.error as Failure).message
                  : l10n.unexpectedError,
            ),
            leading: const Icon(Icons.warning_amber_outlined),
            actions: [
              TextButton(
                onPressed: () => ref.invalidate(cashBalancesProvider),
                child: Text(l10n.retry),
              ),
            ],
          ),
        if (balances.isLoading && accounts.hasValue)
          const LinearProgressIndicator(minHeight: 2),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.end,
              children: [
                const ListExportActions(list: 'cash-accounts'),
                FilledButton.icon(
                  onPressed: _busy ? null : _newAccount,
                  icon: const Icon(Icons.add),
                  label: Text(l10n.newCashAccount),
                ),
              ],
            ),
          ),
        ),
        Expanded(
          child: AsyncStateView<List<Json>>(
            value: accounts,
            onRetry: () => ref.invalidate(cashAccountsProvider),
            isEmpty: (rows) => rows.isEmpty,
            emptyMessage: l10n.noCashAccounts,
            data: (rows) => RecordsTable(
              rows: rows,
              onTap: _showStatement,
              columns: [
                ColumnSpec(
                  l10n.accountCode,
                  value: (r) => text(r, 'code'),
                  emphasise: true,
                ),
                ColumnSpec(
                  l10n.voucherType,
                  // The API stores and returns lowercase `cash`/`bank`, while
                  // this screen creates accounts with `CASH`/`BANK`. Compare
                  // without case so a bank is never labelled a cash box.
                  value: (r) => text(r, 'kind').toUpperCase() == 'BANK'
                      ? l10n.bank
                      : l10n.cashBox,
                ),
                ColumnSpec(
                  isArabic ? l10n.fullNameAr : l10n.fullNameEn,
                  flex: 2,
                  value: (r) => isArabic
                      ? text(r, 'nameAr', fallback: text(r, 'nameEn'))
                      : text(r, 'nameEn', fallback: text(r, 'nameAr')),
                ),
                ColumnSpec(
                  l10n.ledgerAccount,
                  value: (r) => text(r, 'ledgerAccountCode'),
                ),
                ColumnSpec(
                  l10n.balance,
                  numeric: true,
                  emphasise: true,
                  value: (r) => formatAmount(
                    amount(balanceByCode[text(r, 'code')] ?? const {}, 'balance'),
                  ),
                ),
              ],
              actions: (row) => [
                IconButton(
                  tooltip: l10n.statement,
                  icon: const Icon(Icons.receipt_long_outlined, size: 20),
                  onPressed: () => _showStatement(row),
                ),
                IconButton(
                  tooltip: l10n.deactivate,
                  icon: const Icon(Icons.block_outlined, size: 20),
                  onPressed: _busy || !flag(row, 'isActive', fallback: true)
                      ? null
                      : () => _run(() async {
                          await ref
                              .read(apiClientProvider)
                              .post('/cash/accounts/${text(row, 'id')}/deactivate');
                          _reloadAll();
                        }),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _vouchersTab() {
    final l10n = context.l10n;
    final vouchers = ref.watch(cashVouchersProvider);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return Column(
      children: [
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.end,
              children: [
                const ListExportActions(list: 'cash-vouchers'),
                FilledButton.icon(
                  onPressed: _busy ? null : _newVoucher,
                  icon: const Icon(Icons.add),
                  label: Text(l10n.newVoucher),
                ),
              ],
            ),
          ),
        ),
        Expanded(
          child: AsyncStateView<List<Json>>(
            value: vouchers,
            onRetry: () => ref.invalidate(cashVouchersProvider),
            isEmpty: (rows) => rows.isEmpty,
            emptyMessage: l10n.noVouchers,
            data: (rows) => RecordsTable(
              rows: rows,
              columns: [
                ColumnSpec(
                  l10n.voucherNumber,
                  value: (r) => text(r, 'voucherNumber'),
                  emphasise: true,
                ),
                ColumnSpec(l10n.invoiceDate, value: (r) => text(r, 'voucherDate')),
                ColumnSpec(
                  l10n.voucherType,
                  value: (r) =>
                      text(r, 'kind').toUpperCase() == 'RECEIPT' ? l10n.receipt : l10n.payment,
                ),
                ColumnSpec(
                  l10n.party,
                  flex: 2,
                  value: (r) {
                    final customer = isArabic
                        ? text(r, 'customerNameAr', fallback: text(r, 'customerNameEn'))
                        : text(r, 'customerNameEn', fallback: text(r, 'customerNameAr'));
                    return customer.isNotEmpty
                        ? customer
                        : (isArabic
                              ? text(r, 'supplierNameAr', fallback: text(r, 'supplierNameEn'))
                              : text(r, 'supplierNameEn', fallback: text(r, 'supplierNameAr')));
                  },
                ),
                ColumnSpec(
                  l10n.amount,
                  numeric: true,
                  emphasise: true,
                  value: (r) => formatAmount(amount(r, 'amount')),
                ),
                ColumnSpec(
                  l10n.status,
                  value: (r) => text(r, 'status'),
                  tone: (r) => toneForStatus(text(r, 'status')),
                ),
              ],
              actions: (row) => [
                IconButton(
                  tooltip: isArabic
                      ? 'تفاصيل السند والفواتير والقيد'
                      : 'Voucher, invoices and entry',
                  icon: const Icon(Icons.receipt_long_outlined, size: 20),
                  onPressed: () => _showVoucher(row),
                ),
                IconButton(
                  tooltip: isArabic ? 'طباعة وتنزيل المستند' : 'Print and download document',
                  icon: const Icon(Icons.print_outlined, size: 20),
                  onPressed: () => showDialog<void>(
                    context: context,
                    builder: (dialogContext) => AlertDialog(
                      title: Text(
                        '${l10n.voucherNumber}: ${text(row, 'voucherNumber')}',
                      ),
                      content: DocumentExportActions(
                        kind: 'cash-voucher',
                        id: text(row, 'id'),
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(dialogContext).pop(),
                          child: Text(l10n.close),
                        ),
                      ],
                    ),
                  ),
                ),
                if (text(row, 'status').toUpperCase() == 'DRAFT')
                  IconButton(
                    tooltip: l10n.post,
                    icon: const Icon(Icons.check_circle_outline, size: 20),
                    onPressed: _busy
                        ? null
                        : () => _post(
                            '/cash/vouchers/${text(row, 'id')}/post',
                            l10n.confirmPost,
                            l10n.posted,
                          ),
                  ),
                if (text(row, 'status').toUpperCase() == 'POSTED')
                  IconButton(
                    tooltip: l10n.reverse,
                    icon: const Icon(Icons.undo, size: 20),
                    onPressed: _busy
                        ? null
                        : () => _reverse('/cash/vouchers/${text(row, 'id')}/reverse'),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _transfersTab() {
    final l10n = context.l10n;
    final transfers = ref.watch(cashTransfersProvider);

    return Column(
      children: [
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.end,
              children: [
                const ListExportActions(list: 'cash-transfers'),
                FilledButton.icon(
                  onPressed: _busy ? null : _newTransfer,
                  icon: const Icon(Icons.swap_horiz),
                  label: Text(l10n.newTransfer),
                ),
              ],
            ),
          ),
        ),
        Expanded(
          child: AsyncStateView<List<Json>>(
            value: transfers,
            onRetry: () => ref.invalidate(cashTransfersProvider),
            isEmpty: (rows) => rows.isEmpty,
            emptyMessage: l10n.noTransfers,
            data: (rows) => RecordsTable(
              rows: rows,
              columns: [
                ColumnSpec(
                  l10n.voucherNumber,
                  value: (r) => text(r, 'transferNumber'),
                  emphasise: true,
                ),
                ColumnSpec(l10n.invoiceDate, value: (r) => text(r, 'transferDate')),
                ColumnSpec(l10n.fromAccount, value: (r) => text(r, 'fromCode')),
                ColumnSpec(l10n.toAccount, value: (r) => text(r, 'toCode')),
                ColumnSpec(
                  l10n.amount,
                  numeric: true,
                  emphasise: true,
                  value: (r) => formatAmount(amount(r, 'amount')),
                ),
                ColumnSpec(
                  l10n.status,
                  value: (r) => text(r, 'status'),
                  tone: (r) => toneForStatus(text(r, 'status')),
                ),
              ],
              actions: (row) => [
                if (text(row, 'status').toUpperCase() == 'DRAFT')
                  IconButton(
                    tooltip: l10n.post,
                    icon: const Icon(Icons.check_circle_outline, size: 20),
                    onPressed: _busy
                        ? null
                        : () => _post(
                            '/cash/transfers/${text(row, 'id')}/post',
                            l10n.confirmPost,
                            l10n.posted,
                          ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Everything that moved through one box, with a running balance.
class _AccountStatement extends ConsumerWidget {
  const _AccountStatement({required this.cashAccountId, required this.locale});

  final String cashAccountId;
  final String locale;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final statement = ref.watch(cashStatementProvider(cashAccountId));

    return statement.when(
      loading: () => const LoadingView(),
      error: (error, _) => ErrorView(message: error.toString()),
      data: (rows) => rows.isEmpty
          ? EmptyView(message: l10n.noMovements)
          : RecordsTable(
              rows: rows,
              columns: [
                ColumnSpec(l10n.invoiceDate, value: (r) => text(r, 'entryDate')),
                ColumnSpec(
                  l10n.description,
                  flex: 2,
                  value: (r) => text(
                    r,
                    'description',
                    fallback: text(r, 'entryNumber'),
                  ),
                ),
                ColumnSpec(
                  l10n.debit,
                  numeric: true,
                  value: (r) => formatAmount(amount(r, 'debit'), locale: locale),
                ),
                ColumnSpec(
                  l10n.credit,
                  numeric: true,
                  value: (r) => formatAmount(amount(r, 'credit'), locale: locale),
                ),
                ColumnSpec(
                  l10n.balance,
                  numeric: true,
                  emphasise: true,
                  value: (r) => formatAmount(
                    amount(r, 'runningBalance'),
                    locale: locale,
                  ),
                ),
              ],
            ),
    );
  }
}

/// One receipt or payment with the invoices it settled and the entries it
/// wrote. Everything shown here is the server's answer: the money, the
/// allocation and the journal entry are the ones stored, not recomputed.
class _VoucherDetails extends ConsumerWidget {
  const _VoucherDetails({required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final locale = Localizations.localeOf(context).toString();
    final detail = ref.watch(cashVoucherProvider(id));

    return detail.when(
      loading: () => const LoadingView(),
      error: (error, _) => ErrorView(message: error.toString()),
      data: (voucher) {
        final allocations = listOf(voucher['allocations']);
        final entries = listOf(voucher['journalEntries']);
        final draft = text(voucher, 'status').toUpperCase() == 'DRAFT';
        final customer = arabic
            ? text(voucher, 'customerNameAr', fallback: text(voucher, 'customerNameEn'))
            : text(voucher, 'customerNameEn', fallback: text(voucher, 'customerNameAr'));
        final supplier = arabic
            ? text(voucher, 'supplierNameAr', fallback: text(voucher, 'supplierNameEn'))
            : text(voucher, 'supplierNameEn', fallback: text(voucher, 'supplierNameAr'));
        final party = customer.isNotEmpty ? customer : supplier;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 24,
              runSpacing: 8,
              children: [
                _VoucherFact(
                  label: l10n.invoiceDate,
                  value: text(voucher, 'voucherDate'),
                ),
                _VoucherFact(
                  label: l10n.voucherType,
                  value: text(voucher, 'kind').toUpperCase() == 'RECEIPT'
                      ? l10n.receipt
                      : l10n.payment,
                ),
                if (party.isNotEmpty)
                  _VoucherFact(label: l10n.party, value: party),
                _VoucherFact(
                  label: l10n.amount,
                  value: formatAmount(
                    amount(voucher, 'amount'),
                    locale: locale,
                  ),
                ),
                _VoucherFact(
                  label: l10n.status,
                  value: text(voucher, 'status'),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              arabic ? 'الفواتير المسدَّدة' : 'Invoices settled',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 6),
            Expanded(
              child: allocations.isEmpty
                  ? Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(
                        arabic
                            ? 'لم تُخصَّص لفواتير: المبلغ باقٍ على حساب الطرف.'
                            : 'Not applied to an invoice: the money stays on the party account.',
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
                          value: (row) => formatAmount(
                            amount(row, 'invoiceTotal'),
                            locale: locale,
                          ),
                        ),
                        ColumnSpec(
                          l10n.amount,
                          numeric: true,
                          emphasise: true,
                          value: (row) => formatAmount(
                            amount(row, 'amount'),
                            locale: locale,
                          ),
                        ),
                      ],
                    ),
            ),
            const SizedBox(height: 10),
            Text(
              arabic ? 'القيد المحاسبي' : 'Journal entry',
              style: Theme.of(context).textTheme.labelLarge,
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
      },
    );
  }
}

/// A labelled figure in the voucher header.
class _VoucherFact extends StatelessWidget {
  const _VoucherFact({required this.label, required this.value});

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
