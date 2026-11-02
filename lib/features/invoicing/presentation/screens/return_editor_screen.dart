import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/invoice_providers.dart';

class _ReturnLineDraft {
  _ReturnLineDraft({required this.source}) : quantity = TextEditingController();

  final Json source;
  final TextEditingController quantity;

  /// A return must use the same unit the original invoice line used. Legacy
  /// lines have no snapshot and fall back to the item's base unit with a
  /// factor of one, so the arithmetic is unchanged for old documents.
  String get unitName => text(source, 'unitName').isEmpty
      ? text(source, 'unit')
      : text(source, 'unitName');

  Decimal get _factor =>
      Decimal.tryParse(text(source, 'unitFactor', fallback: '1')) ??
      Decimal.one;

  /// Still returnable, expressed in the original unit. The stock figures are
  /// base units, so the base remainder is converted back through the factor.
  Decimal get remaining {
    final quantityValue =
        Decimal.tryParse(text(source, 'quantity')) ?? Decimal.zero;
    final alreadyReturned =
        Decimal.tryParse(text(source, 'returnedQuantity', fallback: '0')) ??
        Decimal.zero;
    final baseRemaining = quantityValue - alreadyReturned;
    final clamped =
        baseRemaining < Decimal.zero ? Decimal.zero : baseRemaining;
    return (clamped / _factor).toDecimal(scaleOnInfinitePrecision: 10);
  }

  void dispose() => quantity.dispose();
}

/// Creates a draft credit/debit note against a posted invoice.
class ReturnEditorScreen extends ConsumerStatefulWidget {
  const ReturnEditorScreen({super.key, required this.kind});

  final InvoiceKind kind;

  @override
  ConsumerState<ReturnEditorScreen> createState() => _ReturnEditorScreenState();
}

class _ReturnEditorScreenState extends ConsumerState<ReturnEditorScreen> {
  final _reason = TextEditingController();
  final _lines = <_ReturnLineDraft>[];
  String? _invoiceId;
  Json? _invoice;
  late String _returnDate;
  bool _loadingSource = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _returnDate = _formatDate(DateTime.now());
  }

  @override
  void dispose() {
    _reason.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  String _formatDate(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';

  Future<void> _loadInvoice(String id) async {
    setState(() {
      _invoiceId = id;
      _invoice = null;
      _loadingSource = true;
      for (final line in _lines) {
        line.dispose();
      }
      _lines.clear();
    });
    try {
      final invoice = await ref
          .read(apiClientProvider)
          .getObject('${widget.kind.basePath}/$id');
      if (!mounted) return;
      final lines = listOf(invoice['lines'])
          .map((source) => _ReturnLineDraft(source: source))
          .toList(growable: false);
      setState(() {
        _invoice = invoice;
        _lines.addAll(lines);
        _loadingSource = false;
        final invoiceDate = DateTime.tryParse(text(invoice, 'invoiceDate'));
        if (invoiceDate != null && DateTime.now().isBefore(invoiceDate)) {
          _returnDate = _formatDate(invoiceDate);
        }
      });
    } on Failure catch (error) {
      if (!mounted) return;
      setState(() => _loadingSource = false);
      showMessage(context, error.message, error: true);
    }
  }

  Future<void> _chooseDate() async {
    final sourceDate = DateTime.tryParse(text(_invoice ?? const {}, 'invoiceDate'));
    final firstDate = sourceDate ?? DateTime(2000);
    final today = DateTime.now();
    final initialDate = today.isBefore(firstDate) ? firstDate : today;
    final selected = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: firstDate,
      lastDate: DateTime(2100),
    );
    if (selected != null && mounted) {
      setState(() => _returnDate = _formatDate(selected));
    }
  }

  List<Json> _eligibleInvoices(List<Json> invoices, String? branchId) =>
      invoices.where((invoice) {
        if (text(invoice, 'status').toLowerCase() != 'posted') return false;
        if (branchId == null) return true;
        return text(invoice, 'branchId') == branchId;
      }).toList(growable: false);

  Future<void> _save() async {
    final l10n = context.l10n;
    if (_invoiceId == null || _invoice == null) {
      showMessage(context, l10n.selectOriginalInvoice, error: true);
      return;
    }
    final lines = <Json>[];
    for (var index = 0; index < _lines.length; index++) {
      final draft = _lines[index];
      final raw = draft.quantity.text.trim();
      if (raw.isEmpty) continue;
      final quantity = Decimal.tryParse(raw);
      if (quantity == null || quantity <= Decimal.zero) {
        showMessage(context, l10n.mustBePositive, error: true);
        return;
      }
      if (quantity > draft.remaining) {
        showMessage(
          context,
          '${l10n.remainingToReturn}: ${draft.remaining.toString()}',
          error: true,
        );
        return;
      }
      lines.add({
        'originalLineId': text(draft.source, 'id'),
        'quantity': raw,
        // Echo the original unit; the server rejects any mismatch.
        if (text(draft.source, 'unitName').isNotEmpty)
          'unitName': text(draft.source, 'unitName'),
      });
    }
    if (lines.isEmpty) {
      showMessage(context, l10n.addLineFirst, error: true);
      return;
    }

    setState(() => _saving = true);
    try {
      await ref.read(apiClientProvider).post(
        widget.kind.returnsPath,
        body: {
          'originalInvoiceId': _invoiceId,
          'returnDate': _returnDate,
          if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
          'lines': lines,
        },
      );
      await ref.read(returnListProvider(widget.kind).notifier).reload();
      if (!mounted) return;
      showMessage(context, l10n.returnCreated);
      context.pop(true);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final invoices = ref.watch(invoiceListProvider(widget.kind));
    final canCreate = user?.branchId != null &&
        (user!.can(widget.kind.isSales ? 'sales.invoices.create' : 'purchases.invoices.create'));

    return ModuleScaffold(
      title: widget.kind.isSales ? l10n.newSalesReturn : l10n.newPurchaseReturn,
      body: invoices.when(
        loading: () => const LoadingView(),
        error: (error, _) => ErrorView(
          message: error.toString(),
          onRetry: () => ref.read(invoiceListProvider(widget.kind).notifier).reload(),
        ),
        data: (rows) {
          final eligible = _eligibleInvoices(rows, user?.branchId);
          if (eligible.isEmpty) {
            return EmptyView(
              message: widget.kind.isSales
                  ? l10n.noSalesInvoices
                  : l10n.noPurchaseInvoices,
              icon: Icons.receipt_long_outlined,
            );
          }
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              DropdownButtonFormField<String>(
                initialValue: _invoiceId,
                decoration: InputDecoration(labelText: l10n.originalInvoice),
                items: [
                  for (final invoice in eligible)
                    DropdownMenuItem(
                      value: text(invoice, 'id'),
                      child: Text(
                        '${text(invoice, 'invoiceNumber')} · ${text(invoice, 'invoiceDate')}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: !canCreate || _saving
                    ? null
                    : (value) {
                        if (value != null) _loadInvoice(value);
                      },
              ),
              if (_invoice != null) ...[
                const SizedBox(height: 14),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Wrap(
                      spacing: 20,
                      runSpacing: 12,
                      children: [
                        Text(
                          '${l10n.originalInvoice}: ${text(_invoice!, 'invoiceNumber')}',
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        Text(
                          '${widget.kind.isSales ? l10n.customer : l10n.supplier}: '
                          '${text(partyOf(_invoice!, widget.kind), 'nameEn', fallback: '—')}',
                        ),
                        TextButton.icon(
                          onPressed: _saving ? null : _chooseDate,
                          icon: const Icon(Icons.calendar_today_outlined),
                          label: Text('${l10n.returnDate}: $_returnDate'),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _reason,
                  enabled: !_saving,
                  decoration: InputDecoration(
                    labelText: l10n.returnReason,
                    prefixIcon: const Icon(Icons.info_outline),
                  ),
                ),
                const SizedBox(height: 16),
                Text(l10n.returnLines, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                if (_loadingSource)
                  const LinearProgressIndicator()
                else if (_lines.isEmpty)
                  EmptyView(message: l10n.noData)
                else
                  for (final line in _lines) _lineCard(context, line),
                const SizedBox(height: 18),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: FilledButton.icon(
                    onPressed: !canCreate || _saving || _loadingSource ? null : _save,
                    icon: _saving
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_outlined),
                    label: Text(l10n.createReturn),
                  ),
                ),
              ],
              if (!canCreate) ...[
                const SizedBox(height: 12),
                Text(
                  l10n.notAvailable,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _lineCard(BuildContext context, _ReturnLineDraft line) {
    final l10n = context.l10n;
    final name = text(line.source, 'itemNameEn').isNotEmpty
        ? text(line.source, 'itemNameEn')
        : text(line.source, 'description', fallback: l10n.invoiceLines);
    final code = text(line.source, 'itemCode');
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            const Icon(Icons.inventory_2_outlined),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(code.isEmpty ? name : '$code · $name'),
                  const SizedBox(height: 4),
                  Text(
                    '${l10n.remainingToReturn}: ${line.remaining.toString()} '
                    '${line.unitName}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 150,
              child: TextField(
                controller: line.quantity,
                enabled: line.remaining > Decimal.zero && !_saving,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                ],
                decoration: InputDecoration(
                  labelText: l10n.quantityToReturn,
                  helperText: line.unitName,
                  isDense: true,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
