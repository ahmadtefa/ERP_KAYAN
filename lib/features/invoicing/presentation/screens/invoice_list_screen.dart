import 'package:flutter/material.dart';

import '../../../operations/ops_auto_create.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/widgets/status_pill.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../dashboard/presentation/providers/dashboard_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../inventory/presentation/providers/stock_providers.dart';
import '../../../accounting/presentation/screens/journal_entries_screen.dart';
import '../invoice_status.dart';
import '../providers/invoice_providers.dart';
import 'invoice_detail_dialog.dart';
import 'invoice_editor_screen.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';

/// Sales and purchase invoices: the list, and the post/reverse actions.
///
/// A draft is harmless — it moves no stock and writes no ledger entry. Posting
/// is therefore the moment the figures become real, and it is always behind a
/// confirmation.
class InvoiceListScreen extends ConsumerStatefulWidget {
  const InvoiceListScreen({
    super.key,
    required this.kind,
    this.navigationKey,
    this.initialInvoiceId,
  });

  final InvoiceKind kind;
  final ValueKey<String>? navigationKey;
  final String? initialInvoiceId;

  @override
  ConsumerState<InvoiceListScreen> createState() => _InvoiceListScreenState();
}

class _InvoiceListScreenState extends ConsumerState<InvoiceListScreen> {
  String _status = '';
  bool _busy = false;
  final _exitRelay = InvoiceDraftExitRelay();
  late final DraftExitGuard _exitGuard;

  @override
  void initState() {
    super.initState();
    opsRunAutoCreate(this, _openEditor);
    final linkedInvoiceId = widget.initialInvoiceId;
    if (linkedInvoiceId != null && linkedInvoiceId.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _openDetail({'id': linkedInvoiceId, 'invoiceNumber': linkedInvoiceId});
        }
      });
    }
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

  String get _basePath => widget.kind.basePath;

  Future<void> _openEditor({String? invoiceId}) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => InvoiceEditorScreen(
          kind: widget.kind,
          invoiceId: invoiceId,
          exitRelay: _exitRelay,
        ),
      ),
    );
  }

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  Future<void> _approveCredit(Json row) async {
    final result = await showFormSheet(
      context,
      title: _t('الموافقة على تجاوز حد الائتمان', 'Approve credit-limit exception'),
      fields: [FieldSpec('reason', _t('سبب الموافقة', 'Approval reason'),
        kind: FieldKind.multiline, required: true,
        helper: _t('سبب مكتوب لا يقل عن ٣ أحرف. تخص هذه الفاتورة فقط ولا ترحّلها.',
          'At least 3 characters. Approves this invoice only, without posting it.'))],
      onSubmit: (draft) async {
        final reason = draft['reason']?.toString().trim() ?? '';
        if (reason.length < 3) {
          throw ApiFailure(_t('اكتب سببًا لا يقل عن ٣ أحرف', 'Enter a reason of at least 3 characters'),
            statusCode: 422, fieldErrors: {'reason': _t('٣ أحرف على الأقل', 'At least 3 characters')});
        }
        try {
          await ref.read(apiClientProvider).post('$_basePath/${row['id']}/credit-approval', body: {'reason': reason});
        } on ApiFailure catch (failure) {
          if (const {400, 403, 404, 409, 422}.contains(failure.statusCode)) rethrow;
          throw UncertainFormSubmission(failure);
        } catch (error) {
          throw UncertainFormSubmission(error);
        }
      },
    );
    if (result != null && mounted) {
      ref.invalidate(invoiceListProvider(widget.kind));
      showMessage(context, _t('تمت الموافقة على التجاوز لهذه الفاتورة. لم تُرحّل الفاتورة.',
        'Credit exception approved for this invoice. The invoice was not posted.'));
    }
  }

  Future<void> _post(Json row) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.post,
      message: l10n.confirmPost,
      confirmLabel: l10n.post,
    );
    if (!ok || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).post('$_basePath/${row['id']}/post');
      await ref.read(invoiceListProvider(widget.kind).notifier).reload();
      if (mounted) showMessage(context, l10n.invoicePosted);
    } on Failure catch (e) {
      if (mounted) {
        ref.invalidate(invoiceListProvider(widget.kind));
        if (e is ApiFailure && e.code == 'CUSTOMER_CREDIT_LIMIT_EXCEEDED') {
          await showAppPlainError(context, _t(
            'ترحيل الفاتورة يتجاوز حد ائتمان العميل. يلزم موافقة مستخدم آخر لديه صلاحية الموافقة على تجاوز حد الائتمان. الفاتورة ما زالت مسودة.',
            'Posting exceeds the customer credit limit. Another user with credit-approval permission must approve it. The invoice is still a draft.'));
        } else {
          showMessage(context, e, error: true);
        }
      }
    } catch (error) {
      if (mounted) {
        // An unexpected failure may still follow a committed server action.
        ref.invalidate(invoiceListProvider(widget.kind));
        showAppError(context, error);
      }
    } finally {
      if (mounted) {
        ref.invalidate(stockListProvider);
        ref.invalidate(journalEntriesProvider);
        invalidateDashboardAndReports(ref);
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _reverse(Json row) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.reverse,
      message: l10n.confirmReverse,
      confirmLabel: l10n.reverse,
      destructive: true,
    );
    if (!ok || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).post('$_basePath/${row['id']}/reverse');
      await ref.read(invoiceListProvider(widget.kind).notifier).reload();
      if (mounted) showMessage(context, l10n.invoiceReversed);
    } on Failure catch (e) {
      if (mounted) {
        ref.invalidate(invoiceListProvider(widget.kind));
        showMessage(context, e, error: true);
      }
    } catch (error) {
      if (mounted) {
        // An unexpected failure may still follow a committed server action.
        ref.invalidate(invoiceListProvider(widget.kind));
        showAppError(context, error);
      }
    } finally {
      if (mounted) {
        ref.invalidate(stockListProvider);
        ref.invalidate(journalEntriesProvider);
        invalidateDashboardAndReports(ref);
        setState(() => _busy = false);
      }
    }
  }

  void _openDetail(Json row) {
    showInvoiceDetail(context, kind: widget.kind, summary: row);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final provider = invoiceListProvider(widget.kind);
    final async = ref.watch(provider);
    final isSales = widget.kind.isSales;
    final user = ref.watch(currentUserProvider);

    return ModuleScaffold(
      title: isSales ? l10n.salesInvoices : l10n.purchaseInvoices,
      actions: [
        ListExportActions(
          list: isSales ? 'sales-invoices' : 'purchase-invoices',
          filters: {'status': ?(_status.isEmpty ? null : _status)},
        ),
      ],
      trailing: Row(
        children: [
          DropdownButton<String>(
            value: _status,
            items: [
              DropdownMenuItem(value: '', child: Text(l10n.allStatuses)),
              DropdownMenuItem(value: 'draft', child: Text(l10n.draft)),
              DropdownMenuItem(value: 'posted', child: Text(l10n.posted)),
              DropdownMenuItem(value: 'reversed', child: Text(l10n.reversed)),
            ],
            onChanged: (value) => setState(() => _status = value ?? ''),
          ),
          const SizedBox(width: 12),
          IconButton(
            tooltip: l10n.refresh,
            onPressed: _busy || async.isLoading
                ? null
                : () => ref.read(provider.notifier).reload(),
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: _busy ? null : _openEditor,
            icon: const Icon(Icons.add),
            label: Text(
              isSales ? l10n.newSalesInvoice : l10n.newPurchaseInvoice,
            ),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(provider.notifier).reload(),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: isSales ? l10n.noSalesInvoices : l10n.noPurchaseInvoices,
        data: (rows) => RecordsTable(
          rows: _filter(rows),
          onTap: _openDetail,
          columns: [
            ColumnSpec(
              l10n.invoiceNumber,
              value: (r) => text(r, 'invoiceNumber'),
              emphasise: true,
            ),
            ColumnSpec(l10n.invoiceDate, value: (r) => text(r, 'invoiceDate')),
            ColumnSpec(
              isSales ? l10n.customer : l10n.supplier,
              value: (r) {
                final party = partyOf(r, widget.kind);
                return party.isEmpty ? '—' : text(party, 'nameEn');
              },
            ),
            ColumnSpec(
              l10n.totalAmount,
              numeric: true,
              value: (r) => formatAmount(asString(r['totalAmount'])),
            ),
            if (isSales)
              ColumnSpec(
                l10n.grossProfit,
                numeric: true,
                value: (r) => formatAmount(asString(r['grossProfit'])),
              )
            else
              ColumnSpec(
                l10n.remaining,
                numeric: true,
                value: (r) => formatAmount(asString(r['balanceDue'])),
              ),
            ColumnSpec(
              l10n.status,
              value: (r) => statusLabel(context, r),
              tone: (r) => toneForStatus(text(r, 'status')),
            ),
          ],
          actions: (row) {
            final status = text(row, 'status').toLowerCase();
            return [
              if (status == 'draft' && !isSales)
                IconButton(
                  tooltip: l10n.editDraftInvoice,
                  icon: const Icon(Icons.edit_outlined, size: 20),
                  onPressed: _busy
                      ? null
                      : () => _openEditor(invoiceId: text(row, 'id')),
                ),
              IconButton(
                tooltip: l10n.viewDetails,
                icon: const Icon(Icons.receipt_long_outlined, size: 20),
                onPressed: () => _openDetail(row),
              ),
              if (status == 'draft' && isSales &&
                  user?.can('sales.credit.approve') == true &&
                  text(row, 'createdBy') != user?.id)
                IconButton(
                  tooltip: _t('الموافقة على تجاوز حد الائتمان', 'Approve credit-limit exception'),
                  icon: const Icon(Icons.verified_user_outlined, size: 20),
                  onPressed: _busy ? null : () => _approveCredit(row),
                ),
              if (status == 'draft' && user?.can(isSales ? 'sales.invoices.post' : 'purchases.invoices.post') == true)
                IconButton(
                  tooltip: l10n.post,
                  icon: const Icon(Icons.check_circle_outline, size: 20),
                  onPressed: _busy ? null : () => _post(row),
                ),
              if (status == 'posted' && user?.can(isSales ? 'sales.invoices.post' : 'purchases.invoices.post') == true)
                IconButton(
                  tooltip: l10n.reverse,
                  icon: const Icon(Icons.undo_outlined, size: 20),
                  onPressed: _busy ? null : () => _reverse(row),
                ),
            ];
          },
        ),
      ),
    );
  }

  List<Json> _filter(List<Json> rows) {
    if (_status.isEmpty) return rows;
    return rows
        .where((r) => text(r, 'status').toLowerCase() == _status)
        .toList(growable: false);
  }
}
