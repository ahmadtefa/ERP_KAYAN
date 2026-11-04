import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/router/draft_exit_guard.dart';
import '../../../core/error/failure.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/confirm_dialog.dart';
import '../../../shared/widgets/state_views.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../dashboard/presentation/providers/dashboard_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';
import '../../invoicing/presentation/providers/invoice_providers.dart';
import '../../inventory/presentation/providers/stock_providers.dart';
import '../../accounting/presentation/screens/journal_entries_screen.dart';
import 'order_retry_store.dart';
import 'order_create_screen.dart';
import 'order_edit_screen.dart';

/// Sales and purchase order monitoring, conversion and linked draft actions.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key, required this.kind, this.navigationKey});
  final InvoiceKind kind;
  final ValueKey<String>? navigationKey;
  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  late Future<List<Json>> _future;
  late final DraftExitGuard _exitGuard;
  final _exitRelay = DraftExitRelay();
  String get _path => widget.kind.isSales ? '/sales/orders' : '/purchases/orders';
  bool get _ar => Localizations.localeOf(context).languageCode == 'ar';
  String tr(String ar, String en) => _ar ? ar : en;

  @override
  void initState() {
    super.initState();
    _exitGuard = ref.read(draftExitGuardProvider);
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _exitRelay.canLeave);
    _future = _load();
  }
  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _exitRelay.canLeave);
    super.dispose();
  }
  Future<List<Json>> _load() => ref.read(apiClientProvider).getList(_path);
  void _refresh() => setState(() { _future = _load(); });

  Future<void> _create() async {
    final id = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => OrderCreateScreen(kind: widget.kind,exitRelay:_exitRelay),
    ));
    if (!mounted) return;
    _refresh();
    final user = ref.read(currentUserProvider);
    if (id != null && (user?.can(widget.kind.isSales ? 'sales.orders.read' : 'purchases.orders.read') ?? false)) {
      await _open({'id': id});
    }
  }

  Future<void> _open(Json row) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(
      builder: (_) => OrderDetailScreen(kind: widget.kind, orderId: text(row, 'id'),exitRelay:_exitRelay),
    ));
    if (mounted) _refresh();
  }

  @override
  Widget build(BuildContext context) => ModuleScaffold(
    title: widget.kind.isSales ? tr('أوامر البيع', 'Sales orders') : tr('أوامر الشراء', 'Purchase orders'),
    actions: [
      if (ref.watch(currentUserProvider)?.can(widget.kind.isSales ? 'sales.orders.create' : 'purchases.orders.create') ?? false)
        IconButton(tooltip: tr('أمر جديد', 'New order'), onPressed: _create, icon: const Icon(Icons.add)),
      IconButton(tooltip: tr('تحديث', 'Refresh'), onPressed: _refresh, icon: const Icon(Icons.refresh)),
    ],
    body: FutureBuilder<List<Json>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.hasError) return ErrorView(message: snapshot.error!, onRetry: _refresh);
        if (!snapshot.hasData) return const LoadingView();
        final orders = snapshot.data!;
        if (orders.isEmpty) return EmptyView(message: tr('لا توجد أوامر', 'No orders'));
        return ListView.builder(
          itemCount: orders.length,
          itemBuilder: (context, index) {
            final order = orders[index];
            return ListTile(
              title: Text(text(order, 'orderNumber')),
              subtitle: Text('${partnerName(order, arabic: _ar)} • ${text(order, 'orderDate')}'),
              trailing: Text('${text(order, 'status')}  •  ${text(order, 'totalAmount')}'),
              onTap: () => _open(order),
            );
          },
        );
      },
    ),
  );
}

class OrderDetailScreen extends ConsumerStatefulWidget {
  const OrderDetailScreen({super.key, required this.kind, required this.orderId, this.exitRelay});
  final InvoiceKind kind;
  final String orderId;
  final DraftExitRelay? exitRelay;
  @override
  ConsumerState<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends ConsumerState<OrderDetailScreen> {
  late Future<Json> _future;
  bool _busy = false;
  Map<String, dynamic>? _pending;
  OrderRetryStore? _store;
  String? _scope;
  bool get _ar => Localizations.localeOf(context).languageCode == 'ar';
  String tr(String ar, String en) => _ar ? ar : en;
  String get _base => widget.kind.isSales ? '/sales/orders' : '/purchases/orders';
  String get _invoiceBase => widget.kind.basePath;
  String get _permissions => widget.kind.isSales ? 'sales' : 'purchases';
  bool _can(String permission) => ref.read(currentUserProvider)?.can(permission) ?? false;

  @override
  void initState() { super.initState(); widget.exitRelay?.attach(_canLeave); _future = _load(); _loadPending(); }
  @override
  void dispose() { widget.exitRelay?.detach(_canLeave); super.dispose(); }
  Future<bool> _canLeave() async => !_busy;
  Future<Json> _load() => ref.read(apiClientProvider).get('$_base/${widget.orderId}');
  void _refresh() {
    setState(() { _future = _load(); });
    ref.invalidate(invoiceListProvider(widget.kind));
  }

  Future<void> _loadPending() async {
    try {
      final user = ref.read(currentUserProvider);
      if (user == null || user.branchId == null) return;
      final store = OrderRetryStore(await SharedPreferences.getInstance());
      final config = ref.read(appConfigProvider);
      final scope = orderRetryScope(apiBaseUrl: config.apiBaseUrl,
        embeddedLocalServer: config.embeddedLocalServer, companyId: user.companyId, branchId: user.branchId!, userId: user.id,
        kind: widget.kind.name, orderId: widget.orderId);
      final pending = store.read(scope);
      if (mounted) setState(() { _store = store; _scope = scope; _pending = pending; });
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    }
  }

  Future<void> _runPending(Map<String, dynamic> request) async {
    setState(() { _busy = true; _pending = request; });
    try {
      final path = request['path'] as String;
      final method = request['method'];
      final body = Map<String, dynamic>.from(request['body'] as Map);
      final amendmentPath = RegExp('^${RegExp.escape(_invoiceBase)}/[0-9a-fA-F-]{36}/order-allocation\$');
      if (method == 'PUT' && (amendmentPath.hasMatch(path) || path == '$_base/${widget.orderId}' || path == '$_base/${widget.orderId}/amend')) {
        await ref.read(apiClientProvider).put(path, body: body);
      } else if (method == 'POST' && path == '$_base/${widget.orderId}/invoice') {
        await ref.read(apiClientProvider).post(path, body: body);
      } else {
        throw const FormatException('Invalid pending order request');
      }
      await _store!.complete(_scope!);
      if (!mounted) return;
      setState(() => _pending = null);
      showMessage(context, tr('تم حفظ العملية وتحديث البيانات', 'Saved and refreshed'));
    } on Failure catch (error) {
      // A conflict may mean that this key already has a result which was
      // subsequently changed or reversed; never silently discard that key.
      // Network/5xx failures are ambiguous and also remain available to retry.
      if (error is ApiFailure && const {400, 422}.contains(error.statusCode)) {
        await _store!.complete(_scope!);
        if (mounted) setState(() => _pending = null);
      }
      if (mounted) showMessage(context, error, error: true);
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) {
        // Even an uncertain conversion may have created or amended an invoice.
        // Re-read the order and invalidate the invoice list, while retaining
        // the exact pending key/body until the server confirms the result.
        _refresh();
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _editDraft(Json order, {bool amendApproved = false}) async {
    await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => OrderEditScreen(kind: widget.kind, order: order, amendApproved: amendApproved,exitRelay:widget.exitRelay),
    ));
    if (!mounted) return;
    await _loadPending();
    if (mounted) _refresh();
  }

  Future<void> _selection(Json order, {Json? invoice}) async {
    if (_busy || _store == null || _scope == null || _pending != null) return;
    setState(() => _busy = true);
    Json? fullInvoice;
    try {
      if (invoice != null) fullInvoice = await ref.read(apiClientProvider).get('$_invoiceBase/${text(invoice, 'id')}');
      if (!mounted) return;
      final chosen = await showDialog<List<Json>>(
        context: context,
        builder: (_) => OrderSelectionDialog(order: order, invoice: fullInvoice),
      );
      if (!mounted || chosen == null) return;
      final path = invoice == null
          ? '$_base/${widget.orderId}/invoice'
          : '$_invoiceBase/${text(invoice, 'id')}/order-allocation';
      final payload = <String, dynamic>{'lines': chosen};
      if (fullInvoice != null) payload['expectedUpdatedAt'] = text(fullInvoice, 'updatedAt');
      final request = await _store!.begin(_scope!, method: invoice == null ? 'POST' : 'PUT', path: path, body: payload);
      if (mounted) await _runPending(request);
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _action(String path, {bool delete = false, bool destructive = false}) async {
    final confirmed = await confirmAction(context,
      title: tr('تأكيد العملية', 'Confirm action'),
      message: tr('هل تريد تنفيذ هذه العملية؟', 'Proceed with this action?'),
      confirmLabel: tr('تأكيد', 'Confirm'), destructive: destructive);
    if (!confirmed || !mounted) return;
    setState(() => _busy = true);
    try {
      if (delete) { await ref.read(apiClientProvider).delete(path); }
      else { await ref.read(apiClientProvider).post(path); }
      if (!mounted) return;
      _refresh();
      showMessage(context, tr('تم تحديث البيانات', 'Data refreshed'));
    } catch (error) {
      // A timeout may follow a committed post, reversal, approval or
      // cancellation. Re-read the authoritative state before enabling actions
      // again rather than leaving a stale draft on screen.
      if (mounted) {
        _refresh();
        showMessage(context, error, error: true);
      }
    } finally {
      if (mounted) {
        if (path.startsWith('$_invoiceBase/') && (path.endsWith('/post') || path.endsWith('/reverse'))) {
          ref.invalidate(stockListProvider);
          ref.invalidate(journalEntriesProvider);
          invalidateDashboardAndReports(ref);
        }
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(canPop:!_busy,child:Scaffold(
    appBar: AppBar(title: Text(tr('تفاصيل الأمر', 'Order details')),
      actions: [IconButton(tooltip: tr('تحديث', 'Refresh'), onPressed: _busy ? null : _refresh, icon: const Icon(Icons.refresh))]),
    body: FutureBuilder<Json>(future: _future, builder: (context, snapshot) {
      if (snapshot.hasError) return ErrorView(message: snapshot.error!, onRetry: _refresh);
      if (!snapshot.hasData) return const LoadingView();
      final order = snapshot.data!;
      final status = text(order, 'status');
      final lines = listOf(order['lines']);
      final invoices = listOf(order['invoices']);
      final canCreateInvoice = _can('$_permissions.invoices.create');
      final canPost = _can('$_permissions.invoices.post');
      return ListView(padding: const EdgeInsets.all(20), children: [
        Text('${text(order, 'orderNumber')} • $status', style: Theme.of(context).textTheme.titleLarge),
        Text('${partnerName(order, arabic: _ar)} • ${text(order, 'orderDate')}'),
        if (_pending != null) Card(child: ListTile(
          title: Text(tr('عملية سابقة لم يتأكد ردها؛ أعد المحاولة بنفس الطلب.', 'An earlier request is unresolved; retry the same request.')),
          trailing: FilledButton(onPressed: _busy ? null : () => _runPending(_pending!), child: Text(tr('إعادة المحاولة', 'Retry'))),
        )),
        Wrap(spacing: 8, children: [
          if (status == 'DRAFT' && _can('$_permissions.orders.manage'))
            OutlinedButton(onPressed: _busy || _pending != null || _store == null ? null : () => _editDraft(order),
              child: Text(tr('تعديل المسودة', 'Edit draft'))),
          if (const {'APPROVED', 'PARTIALLY_FULFILLED'}.contains(status) && _can('$_permissions.orders.manage'))
            OutlinedButton(onPressed: _busy || _pending != null || _store == null ? null : () => _editDraft(order, amendApproved: true),
              child: Text(tr('تعديل الأمر المعتمد', 'Amend approved order'))),
          if (_can('$_permissions.orders.manage') && _pending?['method'] == 'PUT' &&
              (_pending?['path'] == '$_base/${widget.orderId}' || _pending?['path'] == '$_base/${widget.orderId}/amend'))
            OutlinedButton(onPressed: _busy ? null : () => _editDraft(order, amendApproved: _pending?['path'] == '$_base/${widget.orderId}/amend'),
              child: Text(tr('مراجعة التعديل المعلّق', 'Review pending edit'))),
          if (status == 'DRAFT' && _can('$_permissions.orders.approve'))
            OutlinedButton(onPressed: _busy || _pending != null ? null : () => _action('$_base/${widget.orderId}/approve'), child: Text(tr('اعتماد', 'Approve'))),
          if (status != 'CANCELLED' && _can('$_permissions.orders.create'))
            OutlinedButton(onPressed: _busy || _pending != null ? null : () => _action('$_base/${widget.orderId}/cancel', destructive: true), child: Text(tr('إلغاء الأمر', 'Cancel order'))),
          if (const {'APPROVED', 'PARTIALLY_FULFILLED'}.contains(status) && canCreateInvoice)
            FilledButton(onPressed: _busy || _pending != null || _store == null ? null : () => _selection(order), child: Text(tr('تحويل إلى فاتورة', 'Convert to invoice'))),
        ]),
        const Divider(),
        Text(tr('الأسطر والكميات بالوحدة الأساسية', 'Lines and base-unit quantities'), style: Theme.of(context).textTheme.titleMedium),
        for (final line in lines) ListTile(
          title: Text(_ar ? text(line, 'itemNameAr', fallback: text(line, 'itemCode')) : text(line, 'itemNameEn', fallback: text(line, 'itemCode'))),
          subtitle: Text('${tr('الكمية', 'Quantity')}: ${text(line, 'baseQuantity')} • ${tr('المتبقي', 'Remaining')}: ${text(line, 'remainingQuantity')}'),
          trailing: Text('${tr('السعر', 'Price')}: ${text(line, 'unitPrice')}'),
        ),
        const Divider(),
        Text(tr('الفواتير المرتبطة', 'Linked invoices'), style: Theme.of(context).textTheme.titleMedium),
        for (final invoice in invoices) Card(child: ListTile(
          title: Text('${text(invoice, 'invoiceNumber')} • ${text(invoice, 'status')}'),
          subtitle: Text(text(invoice, 'totalAmount')),
          trailing: Wrap(spacing: 4, children: [
            if (text(invoice, 'status') == 'DRAFT' && canCreateInvoice)
              IconButton(tooltip: tr('تعديل التخصيص', 'Edit allocation'), icon: const Icon(Icons.edit_outlined),
                onPressed: _busy || _pending != null || _store == null ? null : () => _selection(order, invoice: invoice)),
            if (text(invoice, 'status') == 'DRAFT' && canCreateInvoice)
              IconButton(tooltip: tr('إلغاء المسودة', 'Cancel draft'), icon: const Icon(Icons.delete_outline),
                onPressed: _busy || _pending != null ? null : () => _action('$_invoiceBase/${text(invoice, 'id')}', delete: true, destructive: true)),
            if (text(invoice, 'status') == 'DRAFT' && canPost)
              IconButton(tooltip: tr('ترحيل', 'Post'), icon: const Icon(Icons.check_circle_outline),
                onPressed: _busy || _pending != null ? null : () => _action('$_invoiceBase/${text(invoice, 'id')}/post')),
            if (text(invoice, 'status') == 'POSTED' && canPost)
              IconButton(tooltip: tr('عكس', 'Reverse'), icon: const Icon(Icons.undo),
                onPressed: _busy || _pending != null ? null : () => _action('$_invoiceBase/${text(invoice, 'id')}/reverse', destructive: true)),
          ]),
        )),
      ]);
    }),
  ));
}

/// Explicit base quantities prevent unselected lines from being invoiced.
class OrderSelectionDialog extends StatefulWidget {
  const OrderSelectionDialog({super.key, required this.order, this.invoice});
  final Json order;
  final Json? invoice;
  @override
  State<OrderSelectionDialog> createState() => _OrderSelectionDialogState();
}

class _OrderSelectionDialogState extends State<OrderSelectionDialog> {
  late final List<Json> lines;
  late final Map<String, TextEditingController> quantities;
  late final Set<String> selected;
  bool get _ar => Localizations.localeOf(context).languageCode == 'ar';
  String tr(String ar, String en) => _ar ? ar : en;

  @override
  void initState() {
    super.initState();
    lines = listOf(widget.order['lines']);
    final prior = {for (final line in listOf(widget.invoice?['lines'])) text(line, 'orderLineId'): text(line, 'baseQuantity')};
    selected = prior.keys.where((id) => id.isNotEmpty).toSet();
    quantities = {for (final line in lines) text(line, 'id'): TextEditingController(text: prior[text(line, 'id')] ?? text(line, 'remainingQuantity'))};
  }

  @override
  void dispose() { for (final controller in quantities.values) { controller.dispose(); } super.dispose(); }

  void _save() {
    final result = <Json>[];
    for (final line in lines) {
      final id = text(line, 'id');
      if (!selected.contains(id)) continue;
      final value = quantities[id]!.text.trim();
      final parsed = Decimal.tryParse(value);
      if (!RegExp(r'^\d+(\.\d{1,4})?$').hasMatch(value) || parsed == null || parsed <= Decimal.zero) {
        showMessage(context, tr('أدخل كمية موجبة بأربع خانات عشرية كحد أقصى', 'Enter a positive quantity with at most four decimal places'), error: true);
        return;
      }
      result.add({'orderLineId': id, 'quantity': value});
    }
    if (result.isEmpty) {
      showMessage(context, tr('اختر سطرًا واحدًا على الأقل', 'Select at least one line'), error: true);
      return;
    }
    Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.invoice == null ? tr('اختيار أسطر الفاتورة', 'Select invoice lines') : tr('تعديل تخصيص المسودة', 'Edit draft allocation')),
    content: SizedBox(width: 600, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Text(tr('أدخل الكميات بالوحدة الأساسية', 'Enter quantities in the base unit')),
      for (final line in lines) Row(children: [
        Checkbox(value: selected.contains(text(line, 'id')), onChanged: (value) => setState(() {
          if (value == true) { selected.add(text(line, 'id')); } else { selected.remove(text(line, 'id')); }
        })),
        Expanded(child: Text(_ar ? text(line, 'itemNameAr', fallback: text(line, 'itemCode')) : text(line, 'itemNameEn', fallback: text(line, 'itemCode')))),
        SizedBox(width: 140, child: TextField(controller: quantities[text(line, 'id')],
          enabled: selected.contains(text(line, 'id')), keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: tr('الكمية الأساسية', 'Base quantity')))),
      ]),
    ]))),
    actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(tr('رجوع', 'Back'))),
      FilledButton(onPressed: _save, child: Text(tr('متابعة', 'Continue')))],
  );
}
