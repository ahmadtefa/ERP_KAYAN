import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
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
import '../../voucher_allocation.dart';
import '../providers/cash_providers.dart';
import '../widgets/voucher_details_view.dart';

/// Cash boxes, bank accounts, receipts, payments and transfers.
///
/// Three lists that belong together: where the money sits, what came in and
/// went out, and what moved between them. Every one of them is posted by the
/// server: this screen never computes a balance, it reports the one the ledger
/// holds. A box is bound to a ledger account, so "how much is in the safe?"
/// has exactly one answer.
class CashScreen extends ConsumerStatefulWidget {
  const CashScreen({super.key, this.navigationKey});

  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<CashScreen> createState() => _CashScreenState();
}

class _CashScreenState extends ConsumerState<CashScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  bool _busy = false;
  final _exitRelay = DraftExitRelay();
  late final DraftExitGuard _exitGuard;

  @override
  void initState() {
    super.initState();
    _exitGuard = ref.read(draftExitGuardProvider);
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _exitRelay.canLeave);
  }

  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _exitRelay.canLeave);
    _tabs.dispose();
    super.dispose();
  }

  /// Re-reads everything a saved receipt, payment or transfer changes.
  ///
  /// The cash lists are the obvious half. The partner's card and statement,
  /// the party lists, the invoices the money settled and the dashboard are
  /// the other half, and they are the half that used to stay stale until the
  /// program was restarted.
  void _reloadAll() {
    invalidateMoneyViews(ref);
  }

  /// A failed response may follow a committed cash action. Refresh all
  /// dependent lists and figures without logging the exception or payload.
  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) {
        _reloadAll();
        setState(() => _busy = false);
      }
    }
  }

  /// Cash creation endpoints do not yet provide idempotency. After a lost
  /// response, refresh and prevent this form from issuing the same POST again.
  Future<void> _submitCreation(String path, Json body) async {
    try {
      await ref.read(apiClientProvider).post(path, body: body);
    } catch (error) {
      throw UncertainFormSubmission(error);
    } finally {
      if (mounted) _reloadAll();
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
    } catch (error) {
      if (mounted) showAppError(context, error);
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
      exitRelay: _exitRelay,
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
      onSubmit: (values) => _submitCreation('/cash/accounts', values),
    );
    if (values != null && mounted) showMessage(context, l10n.saved);
  }

  Future<void> _newVoucher() async {
    final l10n = context.l10n;
    List<Json> accounts;
    try {
      accounts = await ref.read(cashAccountsProvider.future);
    } catch (error) {
      if (mounted) showAppError(context, error);
      return;
    }
    if (!mounted) return;
    if (accounts.isEmpty) {
      showMessage(context, l10n.noCashAccounts, error: true);
      return;
    }

    final kindValues = await showFormSheet(
      context,
      exitRelay: _exitRelay,
      title: l10n.newVoucher,
      fields: [
        FieldSpec(
          'kind',
          l10n.voucherType,
          kind: FieldKind.select,
          required: true,
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
    } catch (error) {
      if (mounted) showAppError(context, error);
      return;
    }
    if (!mounted) return;

    List<Json> parties = const <Json>[];
    try {
      parties = isReceipt
          ? await ref.read(activeCustomersProvider.future)
          : await ref.read(activeSuppliersProvider.future);
    } catch (error) {
      if (mounted) showAppError(context, error);
      return;
    }
    if (!mounted) return;

    final values = await showFormSheet(
      context,
      exitRelay: _exitRelay,
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
      onSubmit: (values) async {
        // Lookup occurs before the POST. A failed lookup leaves the form
        // editable and retryable; a failed POST is conservatively uncertain.
        final partyId = text(values, isReceipt ? 'customerId' : 'supplierId');
        var allocations = const <Json>[];
        if (partyId.isNotEmpty) {
          final invoices = openInvoicesProvider((
            kind: isReceipt ? 'customer' : 'supplier',
            partyId: partyId,
          ));
          // Do not allocate against a cached or previously failed lookup.
          ref.invalidate(invoices);
          final open = await ref.read(invoices.future);
          allocations = planAllocations(
            openInvoices: open,
            amount: text(values, 'amount'),
            isReceipt: isReceipt,
          );
        }
        final body = <String, dynamic>{
          ...values,
          'kind': isReceipt ? 'RECEIPT' : 'PAYMENT',
          if (allocations.isNotEmpty) 'allocations': allocations,
        };
        await _submitCreation('/cash/vouchers', body);
      },
    );
    if (values != null && mounted) showMessage(context, l10n.saved);
  }

  Future<void> _newTransfer() async {
    final l10n = context.l10n;
    List<Json> accounts;
    try {
      accounts = await ref.read(cashAccountsProvider.future);
    } catch (error) {
      if (mounted) showAppError(context, error);
      return;
    }
    if (!mounted) return;
    if (accounts.length < 2) {
      showMessage(context, l10n.transferNeedsTwoAccounts, error: true);
      return;
    }

    final values = await showFormSheet(
      context,
      exitRelay: _exitRelay,
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
      onSubmit: (values) => _submitCreation('/cash/transfers', values),
    );
    if (values != null && mounted) showMessage(context, l10n.saved);
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
  void _showVoucher(Json voucher) => showVoucherDetail(
        context,
        id: text(voucher, 'id'),
        title: text(voucher, 'voucherNumber'),
      );

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
    // Absence, loading, and errors are not zero balances. Match on the
    // stable account id, and only display amounts from a successful response.
    final balanceById = {
      if (!balances.hasError && !balances.isLoading)
        for (final row in balances.value ?? const <Json>[])
          text(row, 'cashAccountId'): row,
    };

    return Column(
      children: [
        if (balances.hasError)
          MaterialBanner(
            content: Text(l10n.unexpectedError),
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
                  value: (r) {
                    final balance = asString(balanceById[text(r, 'id')]?['balance']);
                    return balance == null || balance.isEmpty ? '—' : formatAmount(balance);
                  },
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
                  value: (r) => partnerName(r, arabic: isArabic),
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

/// The chain behind one voucher: what it settled and which entry it wrote.
///
/// Opened from the cash list and from a partner's statement of account; the
/// dialog is the same one in both places, read from the server either way.
/// `onOpen` is how the caller answers "show me the screen behind this": the
/// list simply goes there, while a statement closes itself first.
void showVoucherDetail(
  BuildContext context, {
  required String id,
  required String title,
  void Function(String path)? onOpen,
}) {
  showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 820,
        height: 520,
        child: _VoucherDetails(
          id: id,
          onOpen: (path) {
            Navigator.of(dialogContext).pop();
            if (onOpen != null) {
              onOpen(path);
            } else {
              context.go(path);
            }
          },
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

/// Loads one voucher and hands it to the view that draws it.
class _VoucherDetails extends ConsumerWidget {
  const _VoucherDetails({required this.id, required this.onOpen});

  final String id;
  final void Function(String path) onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(cashVoucherProvider(id));
    return detail.when(
      loading: () => const LoadingView(),
      error: (error, _) => ErrorView(message: error.toString()),
      data: (voucher) => VoucherDetailsView(voucher: voucher, onOpen: onOpen),
    );
  }
}
