import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../dashboard/presentation/providers/dashboard_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../orders/presentation/order_retry_store.dart';
import '../../../invoicing/presentation/screens/invoice_editor_screen.dart'
    show lineUnitsOf;
import '../../../data/presentation/widgets/document_export_actions.dart';
import '../providers/stock_providers.dart';
import '../../../accounting/presentation/screens/journal_entries_screen.dart';

const _base = '/inventory/stock-documents';
String _label(BuildContext context, String ar, String en) =>
    Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

String _localizedName(
  BuildContext context,
  Json row, {
  String ar = 'nameAr',
  String en = 'nameEn',
}) {
  final arabic = Localizations.localeOf(context).languageCode == 'ar';
  return text(row, arabic ? ar : en, fallback: text(row, arabic ? en : ar));
}

/// Show the required acknowledgement once per failed load, without exposing
/// transport diagnostics. Retrying fetches the original source again.
class _VoucherLoadError extends StatefulWidget {
  const _VoucherLoadError({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;
  @override
  State<_VoucherLoadError> createState() => _VoucherLoadErrorState();
}

class _VoucherLoadErrorState extends State<_VoucherLoadError> {
  @override
  void initState() {
    super.initState();
    _report();
  }

  @override
  void didUpdateWidget(covariant _VoucherLoadError oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.error != widget.error) _report();
  }

  void _report() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) showAppError(context, widget.error);
    });
  }

  @override
  Widget build(BuildContext context) =>
      ErrorView(message: widget.error, onRetry: widget.onRetry);
}

/// The list is sourced from the server after every action, not an optimistic
/// local status. Pagination prevents old vouchers from silently disappearing.
class StockVouchersScreen extends ConsumerStatefulWidget {
  const StockVouchersScreen({super.key, this.exitRelay});
  final DraftExitRelay? exitRelay;
  @override
  ConsumerState<StockVouchersScreen> createState() =>
      _StockVouchersScreenState();
}

class _StockVouchersScreenState extends ConsumerState<StockVouchersScreen> {
  int _page = 1;
  final _search = TextEditingController();
  String _query = '';
  late Future<Json> _future;
  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Json> _load() async {
    final branchId = ref.read(currentUserProvider)?.branchId;
    if (branchId == null) throw StateError('No user branch');
    return ref
        .read(apiClientProvider)
        .getObject(
          _base,
          query: {
            'page': _page,
            'pageSize': 50,
            'branchId': branchId,
            'voucherOnly': 'true',
            if (_query.isNotEmpty) 'q': _query,
          },
        );
  }

  void _refresh() => setState(() {
    _future = _load();
  });
  void _submitSearch() {
    _query = _search.text.trim();
    _page = 1;
    _refresh();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _create(String kind) async {
    await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) =>
            StockVoucherCreateScreen(kind: kind, exitRelay: widget.exitRelay),
      ),
    );
    if (mounted) _refresh();
  }

  Future<void> _detail(String id) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) =>
            StockVoucherDetailScreen(id: id, exitRelay: widget.exitRelay),
      ),
    );
    if (mounted) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final canCreate = user?.can('inventory.stock.adjust') ?? false;
    final canPrepare =
        canCreate &&
        (user?.can('inventory.items.read') ?? false) &&
        (user?.can('inventory.warehouses.read') ?? false);
    final canAssignCostCenter =
        user?.can('accounting.costcenters.read') ?? false;
    final canIssue = canPrepare && canAssignCostCenter;
    final canSeeCost = user?.can('inventory.cost.read') ?? false;
    return Scaffold(
      appBar: AppBar(
        title: Text(_label(context, 'أذون المخزون', 'Stock vouchers')),
      ),
      body: Column(
        children: [
          Wrap(
            spacing: 8,
            children: [
              if (canPrepare && canSeeCost)
                FilledButton(
                  onPressed: () => _create('RECEIPT'),
                  child: Text(_label(context, 'إذن إضافة', 'New receipt')),
                ),
              if (canIssue)
                FilledButton(
                  onPressed: () => _create('ISSUE'),
                  child: Text(_label(context, 'إذن صرف', 'New issue')),
                ),
              if (canPrepare && !canAssignCostCenter)
                Text(
                  _label(
                    context,
                    'يلزم صلاحية قراءة مراكز التكلفة لإنشاء إذن صرف',
                    'Cost-centre read permission is required to issue stock',
                  ),
                ),
              if (canCreate && !canPrepare)
                Text(
                  _label(
                    context,
                    'يلزم صلاحية قراءة الأصناف والمخازن لإنشاء إذن',
                    'Item and warehouse read permissions are required to create a voucher',
                  ),
                ),
              IconButton(
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
                tooltip: _label(context, 'تحديث', 'Refresh'),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _search,
                    maxLength: 120,
                    onSubmitted: (_) => _submitSearch(),
                    decoration: InputDecoration(
                      labelText: _label(
                        context,
                        'البحث بالرقم أو الجهة أو السبب',
                        'Search by number, counterparty or reason',
                      ),
                      counterText: '',
                    ),
                  ),
                ),
                IconButton(
                  tooltip: _label(context, 'بحث', 'Search'),
                  onPressed: _submitSearch,
                  icon: const Icon(Icons.search),
                ),
              ],
            ),
          ),
          Expanded(
            child: FutureBuilder<Json>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return _VoucherLoadError(
                    error: snapshot.error!,
                    onRetry: _refresh,
                  );
                }
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final data = snapshot.data!;
                final rows = listOf(data['items'])
                    .where((row) => text(row, 'voucherKind').isNotEmpty)
                    .toList();
                final total = (data['total'] as num?)?.toInt() ?? 0;
                return Column(
                  children: [
                    Expanded(
                      child: rows.isEmpty
                          ? Center(
                              child: Text(
                                _label(
                                  context,
                                  'لا توجد أذون في هذه الصفحة',
                                  'No vouchers on this page',
                                ),
                              ),
                            )
                          : ListView(
                              children: [
                                for (final row in rows)
                                  ListTile(
                                    title: Text(
                                      '${text(row, 'documentNumber')} • ${text(row, 'voucherKind')}',
                                    ),
                                    subtitle: Text(
                                      '${text(row, 'documentDate')} • ${text(row, 'status')} • ${text(row, 'counterpartyName')}',
                                    ),
                                    onTap: () => _detail(text(row, 'id')),
                                  ),
                              ],
                            ),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        TextButton(
                          onPressed: _page > 1
                              ? () {
                                  _page--;
                                  _refresh();
                                }
                              : null,
                          child: Text(_label(context, 'السابق', 'Previous')),
                        ),
                        Text('$_page'),
                        TextButton(
                          onPressed: _page * 50 < total
                              ? () {
                                  _page++;
                                  _refresh();
                                }
                              : null,
                          child: Text(_label(context, 'التالي', 'Next')),
                        ),
                      ],
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class StockVoucherDetailScreen extends ConsumerStatefulWidget {
  const StockVoucherDetailScreen({super.key, required this.id, this.exitRelay});
  final String id;
  final DraftExitRelay? exitRelay;
  @override
  ConsumerState<StockVoucherDetailScreen> createState() =>
      _StockVoucherDetailScreenState();
}

class _StockVoucherDetailScreenState
    extends ConsumerState<StockVoucherDetailScreen> {
  late Future<Json> _future;
  bool _busy = false, _confirming = false;
  @override
  void initState() {
    super.initState();
    widget.exitRelay?.attach(_canLeave);
    _future = _load();
  }

  @override
  void dispose() {
    widget.exitRelay?.detach(_canLeave);
    super.dispose();
  }

  Future<bool> _canLeave() async => !_busy && !_confirming;
  Future<Json> _load() =>
      ref.read(apiClientProvider).getObject('$_base/${widget.id}');
  void _refresh() => setState(() {
    _future = _load();
  });
  Future<void> _edit(Json doc) async {
    await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => StockVoucherCreateScreen(
          kind: text(doc, 'voucherKind'),
          initialDocument: doc,
          exitRelay: widget.exitRelay,
        ),
      ),
    );
    if (mounted) _refresh();
  }

  Future<void> _action(String action, int? version) async {
    if (_busy || _confirming) return;
    setState(() => _confirming = true);
    final ok = await confirmAction(
      context,
      title: _label(context, 'تأكيد العملية', 'Confirm action'),
      message: _label(
        context,
        'هل تريد تنفيذ العملية؟',
        'Proceed with this action?',
      ),
      confirmLabel: _label(context, 'تأكيد', 'Confirm'),
      destructive: action == 'reverse',
    );
    if (!mounted) return;
    setState(() => _confirming = false);
    if (!ok) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post(
            '$_base/${widget.id}/$action',
            body: {'expectedVersion': version},
          );
      if (mounted) {
        _refresh();
        showMessage(
          context,
          _label(context, 'تم تحديث الإذن', 'Voucher refreshed'),
        );
      }
    } catch (error) {
      if (mounted) {
        _refresh();
        showAppError(context, error);
      }
    } finally {
      if (mounted) {
        if (action == 'post' || action == 'reverse') {
          // A failed network response can still follow a committed transaction.
          ref.invalidate(stockListProvider);
          ref.invalidate(journalEntriesProvider);
          invalidateDashboardAndReports(ref);
        }
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    bool can(String permission) => user?.can(permission) ?? false;
    return PopScope(
      canPop: !_busy && !_confirming,
      child: Scaffold(
        appBar: AppBar(
          title: Text(_label(context, 'تفاصيل الإذن', 'Voucher details')),
        ),
        body: FutureBuilder<Json>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return _VoucherLoadError(
                error: snapshot.error!,
                onRetry: _refresh,
              );
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final doc = snapshot.data!;
            final status = text(doc, 'status').toLowerCase();
            final version = doc['editVersion'] is int
                ? doc['editVersion'] as int
                : null;
            final reviewed = asString(doc['reviewedAt']) != null,
                approved = asString(doc['approvedAt']) != null;
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  '${text(doc, 'documentNumber')} • ${text(doc, 'voucherKind')} • $status',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Text(
                  '${_label(context, 'التاريخ', 'Date')}: ${text(doc, 'documentDate')}',
                ),
                Text(
                  '${_label(context, 'الجهة', 'Counterparty')}: ${text(doc, 'counterpartyName')}',
                ),
                Text(
                  '${_label(context, 'السبب', 'Reason')}: ${text(doc, 'reason')}',
                ),
                Text(
                  '${_label(context, 'المخزن', 'Warehouse')}: ${doc['toWarehouse'] is Map ? _localizedName(context, Map<String, dynamic>.from(doc['toWarehouse'] as Map)) : text(doc, 'toWarehouseId')}',
                ),
                Text(
                  '${_label(context, 'مركز التكلفة', 'Cost center')}: ${doc['costCenter'] is Map ? _localizedName(context, Map<String, dynamic>.from(doc['costCenter'] as Map)) : '—'}',
                ),
                Text(
                  '${_label(context, 'ملاحظات', 'Notes')}: ${text(doc, 'notes', fallback: '—')}',
                ),
                Text(
                  '${_label(context, 'القيد', 'Journal entry')}: ${text(doc, 'journalEntryId', fallback: '—')}',
                ),
                Text(
                  '${_label(context, 'المراجعة', 'Reviewed')}: ${text(doc, 'reviewedAt', fallback: '—')}',
                ),
                Text(
                  '${_label(context, 'الاعتماد', 'Approved')}: ${text(doc, 'approvedAt', fallback: '—')}',
                ),
                for (final line in listOf(doc['lines']))
                  ListTile(
                    title: Text(
                      '${text(line, 'itemCode')} • ${_localizedName(context, line, ar: 'itemNameAr', en: 'itemNameEn')}',
                    ),
                    subtitle: Text(
                      '${_label(context, 'الكمية', 'Quantity')}: ${text(line, 'unitQuantity', fallback: text(line, 'quantity'))} • ${text(line, 'unit')}${text(line, 'notes').isEmpty ? '' : ' • ${text(line, 'notes')}'}',
                    ),
                    trailing: can('inventory.cost.read')
                        ? Text(
                            '${_label(context, 'تكلفة الوحدة الأساسية', 'Base unit cost')}: ${text(line, 'unitCost')}',
                          )
                        : null,
                  ),
                if (can('admin.audit.read'))
                  _VoucherHistory(
                    key: ValueKey('${widget.id}:$status:$reviewed:$approved'),
                    id: widget.id,
                  ),
                if (can('inventory.export'))
                  DocumentExportActions(kind: 'stock-voucher', id: widget.id),
                Wrap(
                  spacing: 8,
                  children: [
                    if (status == 'draft' &&
                        can('inventory.stock.adjust') &&
                        can('inventory.items.read') &&
                        can('inventory.warehouses.read') &&
                        (text(doc, 'voucherKind') != 'RECEIPT' ||
                            can('inventory.cost.read')) &&
                        doc['editVersion'] is int)
                      OutlinedButton(
                        onPressed: _busy || _confirming
                            ? null
                            : () => _edit(doc),
                        child: Text(
                          _label(context, 'تعديل المسودة', 'Edit draft'),
                        ),
                      ),
                    if (status == 'draft' &&
                        version != null &&
                        !reviewed &&
                        can('inventory.stock.review'))
                      OutlinedButton(
                        onPressed: _busy || _confirming
                            ? null
                            : () => _action('review', version),
                        child: Text(_label(context, 'مراجعة', 'Review')),
                      ),
                    if (status == 'draft' &&
                        version != null &&
                        reviewed &&
                        !approved &&
                        can('inventory.stock.approve'))
                      OutlinedButton(
                        onPressed: _busy || _confirming
                            ? null
                            : () => _action('approve', version),
                        child: Text(_label(context, 'اعتماد', 'Approve')),
                      ),
                    if (status == 'draft' &&
                        version != null &&
                        approved &&
                        can('inventory.stock.adjust'))
                      FilledButton(
                        onPressed: _busy || _confirming
                            ? null
                            : () => _action('post', version),
                        child: Text(_label(context, 'ترحيل', 'Post')),
                      ),
                    if (status == 'posted' && can('inventory.stock.adjust'))
                      OutlinedButton(
                        onPressed: _busy || _confirming
                            ? null
                            : () => _action('reverse', version),
                        child: Text(_label(context, 'عكس', 'Reverse')),
                      ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _VoucherHistory extends ConsumerStatefulWidget {
  const _VoucherHistory({super.key, required this.id});
  final String id;
  @override
  ConsumerState<_VoucherHistory> createState() => _VoucherHistoryState();
}

class _VoucherHistoryState extends ConsumerState<_VoucherHistory> {
  Future<List<Json>>? _future;
  Future<List<Json>> _load() {
    final future = Future<List<Json>>.sync(
      () => ref
          .read(apiClientProvider)
          .getList(
            '/admin/audit-logs',
            query: {
              'entity': 'stock_documents',
              'entityId': widget.id,
              'pageSize': 200,
            },
          ),
    );
    // The result is still delivered to FutureBuilder. This listener prevents
    // a fast failure escaping before the expansion has mounted that builder.
    future.ignore();
    return future;
  }

  @override
  Widget build(BuildContext context) => ExpansionTile(
    title: Text(_label(context, 'السجل', 'History')),
    // The child FutureBuilder is not mounted while the tile is collapsed.
    // Start the request only when expanding so an early failure is observed.
    onExpansionChanged: (expanded) {
      if (expanded && _future == null) {
        setState(() {
          _future = _load();
        });
      }
    },
    children: [
      if (_future != null)
        FutureBuilder<List<Json>>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const CircularProgressIndicator();
            }
            if (snapshot.hasError) {
              return _VoucherLoadError(
                error: snapshot.error!,
                onRetry: () => setState(() {
                  _future = _load();
                }),
              );
            }
            if (!snapshot.hasData) return const CircularProgressIndicator();
            return Column(
              children: [
                for (final event in snapshot.data!)
                  ListTile(
                    title: Text(text(event, 'action')),
                    subtitle: Text(
                      '${text(event, 'createdAt')} • ${text(event, 'userId')}',
                    ),
                  ),
              ],
            );
          },
        ),
    ],
  );
}

class _VoucherLine {
  String? id, originalItemId, originalUnitName, notes;
  String? itemId;
  String? unitName;
  final barcode = TextEditingController();

  /// Scanning state belongs to the line, not to the screen: two lines in the
  /// same document may legitimately hold different items, and a repeat guard
  /// shared between them would swallow the second line's first scan.
  String? lastScanCode;
  DateTime? lastScanAt;
  bool scanInFlight = false;
  final quantity = TextEditingController();
  final cost = TextEditingController();
  void dispose() {
    barcode.dispose();
    quantity.dispose();
    cost.dispose();
  }
}

/// A retained request always keeps the original body/key until a successful
/// replay. Ambiguous failures, including conflicts, are never discarded.
class StockVoucherCreateScreen extends ConsumerStatefulWidget {
  const StockVoucherCreateScreen({
    super.key,
    required this.kind,
    this.exitRelay,
    this.initialDocument,
  });
  final String kind;
  final Json? initialDocument;
  final DraftExitRelay? exitRelay;
  @override
  ConsumerState<StockVoucherCreateScreen> createState() =>
      _StockVoucherCreateScreenState();
}

class _StockVoucherCreateScreenState
    extends ConsumerState<StockVoucherCreateScreen> {
  final _form = GlobalKey<FormState>();
  final _date = TextEditingController(),
      _reason = TextEditingController(),
      _party = TextEditingController(),
      _notes = TextEditingController();
  final _lines = <_VoucherLine>[_VoucherLine()];
  String? _warehouse, _center, _scope;
  int? _editVersion;
  bool get _editing => widget.initialDocument != null;
  String get _path => _editing
      ? '$_base/${text(widget.initialDocument!, 'id')}/voucher-draft'
      : _base;
  OrderRetryStore? _store;
  Map<String, dynamic>? _pending;
  late Future<List<List<Json>>> _options;
  bool _busy = false, _dirty = false, _confirming = false, _loadingMore = false;
  bool _moreItems = false, _moreCenters = false;
  int _itemPage = 1, _centerPage = 1;
  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _date.text =
        '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    if (_editing) _restoreDocument(widget.initialDocument!);
    widget.exitRelay?.attach(_confirmExit);
    _options = _loadOptions();
    _loadPending();
  }

  Future<List<List<Json>>> _loadOptions() async {
    final user = ref.read(currentUserProvider);
    final api = ref.read(apiClientProvider);
    if (user?.branchId == null) throw StateError('No user branch');
    final centers = (user?.can('accounting.costcenters.read') ?? false)
        ? api.getList(
            '/accounting/cost-centers',
            query: {'pageSize': 100, 'page': 1},
          )
        : Future.value(<Json>[]);
    final options = await Future.wait([
      api.getList('/inventory/items', query: {'pageSize': 200, 'page': 1}),
      api.getList('/inventory/warehouses', query: {'branchId': user!.branchId}),
      centers,
    ]);
    _moreItems = options[0].length == 200;
    _moreCenters = options[2].length == 100;
    return options;
  }

  Future<void> _loadMore(
    List<List<Json>> options, {
    required bool items,
  }) async {
    if (_loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = (items ? _itemPage : _centerPage) + 1;
      final rows = await ref
          .read(apiClientProvider)
          .getList(
            items ? '/inventory/items' : '/accounting/cost-centers',
            query: {'pageSize': items ? 200 : 100, 'page': page},
          );
      if (!mounted) return;
      setState(() {
        if (items) {
          _itemPage = page;
          _moreItems = rows.length == 200;
        } else {
          _centerPage = page;
          _moreCenters = rows.length == 100;
        }
        final index = items ? 0 : 2;
        final ids = options[index].map((row) => text(row, 'id')).toSet();
        final additions = rows.where((row) => ids.add(text(row, 'id')));
        final updated = [...options];
        updated[index] = [...options[index], ...additions];
        _options = Future.value(updated);
      });
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  /// A scanner is a keyboard: it types the code and presses Enter. Some models
  /// send Enter twice, and a slow network lets an impatient operator press it
  /// again while the first request is still out. Either one must not put the
  /// same item on the document twice, so a line refuses a repeat of the code it
  /// just accepted, and refuses any scan while one is already in flight.
  bool _isRepeatScan(_VoucherLine line, String code) {
    if (line.scanInFlight) return true;
    return line.lastScanCode == code &&
        line.lastScanAt != null &&
        DateTime.now().difference(line.lastScanAt!) <
            const Duration(milliseconds: 800);
  }

  Future<void> _scanBarcode(
    _VoucherLine line,
    String rawCode,
    List<Json> items,
  ) async {
    final code = rawCode.trim();
    if (code.isEmpty || _busy) return;
    if (_isRepeatScan(line, code)) {
      // Clear the field so the next scan starts clean, but do not send the
      // request a second time or touch the line.
      line.barcode.clear();
      return;
    }
    line.scanInFlight = true;
    try {
      final payload = await ref
          .read(apiClientProvider)
          .getObject(
            '/inventory/items/by-barcode/${Uri.encodeComponent(code)}',
          );
      final rawItem = payload['item'];
      if (rawItem is! Map) {
        throw const FormatException('Barcode result has no item');
      }
      final item = Map<String, dynamic>.from(rawItem);
      final id = text(item, 'id');
      if (id.isEmpty) {
        throw const FormatException('Barcode result has no item id');
      }
      final unit = text(payload, 'unit', fallback: text(item, 'unit'));
      if (!mounted) return;
      // The quantity box always holds a number in the *selected* unit, never
      // the base units the barcode endpoint reports. A carton label whose
      // factor is 24 means one carton, so the box reads 1; the server
      // multiplies by that factor when the document is created. Writing 24
      // here would be multiplied a second time and store 576 pieces.
      //
      // A repeat scan of the unit already on the line adds one more of it, so
      // scanning a carton twice gives 2 cartons. A scan that selects a
      // different unit or item starts again at one - it is a new thing being
      // scanned, not another copy of the old one.
      final sameSelection = line.itemId == id && line.unitName == unit;
      final previous = sameSelection
          ? Decimal.tryParse(line.quantity.text.trim())
          : null;
      final current = previous != null && previous > Decimal.zero
          ? previous
          : Decimal.zero;
      final next = current + Decimal.one;
      setState(() {
        line.itemId = id;
        line.unitName = unit;
        line.quantity.text = _plainDecimal(next);
        line.barcode.clear();
        final updatedItems = [...items];
        final index = updatedItems.indexWhere((row) => text(row, 'id') == id);
        if (index < 0) {
          updatedItems.add(item);
        } else {
          updatedItems[index] = item;
        }
        _options = _options.then(
          (options) => [updatedItems, options[1], options[2]],
        );
      });
      // Remember the code as accepted only now: a failed lookup must be
      // retryable by scanning the same label again straight away.
      line.lastScanCode = code;
      line.lastScanAt = DateTime.now();
      _changed();
    } catch (error) {
      // A 404 here means one specific thing: the code is not an item of this
      // company and not one of its units. The generic "record not found" the
      // error resolver produces would leave the operator unsure whether the
      // scanner read the label at all, so say what was scanned and what to do.
      if (mounted) {
        final missing = _barcodeFailureMessage(error, code);
        // A message this screen composed itself is shown as written; the
        // resolver would classify an English sentence it did not produce as
        // untrusted and replace it with a generic sentence that does not name
        // the barcode the operator just scanned. Anything else is a real
        // diagnostic - a permission or network error - and still goes through
        // the resolver.
        if (missing != null) {
          await showAppPlainError(context, missing);
        } else {
          await showAppError(context, error);
        }
      }
    } finally {
      line.scanInFlight = false;
    }
  }

  /// Turns a barcode lookup failure into something an operator can act on.
  /// Anything that is not "no such barcode" is passed through untouched: a
  /// permission or network problem must not be reported as a bad label.
  /// Null when the failure is not "no such barcode": a permission or network
  /// problem must be reported as itself, not as a bad label.
  String? _barcodeFailureMessage(Object error, String code) {
    final isMissing = error is ApiFailure
        ? error.statusCode == 404
        : error.toString().contains('404');
    if (!isMissing) return null;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return arabic
        ? 'لا يوجد صنف أو وحدة بهذا الباركود: $code. تحقق من الملصق أو ابحث عن الصنف يدويًا.'
        : 'No item or unit carries the barcode $code. Check the label or search for the item by name.';
  }

  Future<void> _loadPending() async {
    try {
      final user = ref.read(currentUserProvider);
      if (user?.branchId == null) throw StateError('No user branch');
      final config = ref.read(appConfigProvider);
      final scope = orderRetryScope(
        apiBaseUrl: config.apiBaseUrl,
        embeddedLocalServer: config.embeddedLocalServer,
        companyId: user!.companyId,
        branchId: user.branchId!,
        userId: user.id,
        kind: _editing ? 'stock-voucher-edit' : 'stock-voucher',
        orderId: _editing ? text(widget.initialDocument!, 'id') : widget.kind,
      );
      final store = OrderRetryStore(await SharedPreferences.getInstance());
      final pending = store.read(scope);
      if (!mounted) return;
      if (pending != null) _restore(pending);
      setState(() {
        _store = store;
        _scope = scope;
        _pending = pending;
      });
    } catch (error) {
      if (mounted) showAppError(context, error);
    }
  }

  void _restoreDocument(Json doc) {
    if (text(doc, 'id').isEmpty ||
        text(doc, 'voucherKind') != widget.kind ||
        doc['editVersion'] is! int) {
      throw const FormatException('Invalid voucher draft');
    }
    _editVersion = doc['editVersion'] as int;
    final raw = listOf(doc['lines']);
    if (raw.isEmpty) throw const FormatException('Invalid voucher lines');
    final old = List<_VoucherLine>.from(_lines);
    _lines.clear();
    for (final row in raw) {
      final line = _VoucherLine()
        ..id = asString(row['id'])
        ..itemId = asString(row['itemId'])
        ..unitName = asString(row['unitName'])
        ..notes = asString(row['notes']);
      line.originalItemId = line.itemId;
      line.originalUnitName = line.unitName;
      line.quantity.text = text(
        row,
        'unitQuantity',
        fallback: text(row, 'quantity'),
      ).replaceFirst(RegExp(r'^-'), '');
      line.cost.text = text(row, 'unitCost');
      _lines.add(line);
    }
    _warehouse = asString(doc['toWarehouseId']);
    _center = asString(doc['costCenterId']);
    _date.text = text(doc, 'documentDate');
    _reason.text = text(doc, 'reason');
    _party.text = text(doc, 'counterpartyName');
    _notes.text = text(doc, 'notes');
    for (final line in old) {
      line.dispose();
    }
  }

  void _restore(Map<String, dynamic> request) {
    if (request['method'] != (_editing ? 'PUT' : 'POST') ||
        request['path'] != _path ||
        request['body'] is! Map) {
      throw const FormatException('Invalid pending voucher');
    }
    final body = Map<String, dynamic>.from(request['body'] as Map);
    if (!_editing && body['voucherKind'] != widget.kind) {
      throw const FormatException('Invalid pending voucher kind');
    }
    if (_editing && body['expectedVersion'] is! int) {
      throw const FormatException('Invalid voucher version');
    }
    if (_editing) _editVersion = body['expectedVersion'] as int;
    final raw = listOf(body['lines']);
    if (raw.isEmpty) {
      throw const FormatException('Invalid pending voucher lines');
    }
    final old = List<_VoucherLine>.from(_lines);
    _lines.clear();
    for (final row in raw) {
      final line = _VoucherLine()
        ..id = asString(row['id'])
        ..itemId = asString(row['itemId'])
        ..unitName = asString(row['unitName'])
        ..notes = asString(row['notes']);
      if (_editing) {
        final original = listOf(widget.initialDocument!['lines'])
            .where((entry) => text(entry, 'id') == line.id)
            .firstOrNull;
        line.originalItemId = original == null
            ? null
            : asString(original['itemId']);
        line.originalUnitName = original == null
            ? null
            : asString(original['unitName']);
      }
      line.quantity.text = text(
        row,
        'quantity',
      ).replaceFirst(RegExp(r'^-'), '');
      line.cost.text = text(row, 'unitCost');
      _lines.add(line);
    }
    _warehouse = asString(body['toWarehouseId']);
    _center = asString(body['costCenterId']);
    _date.text = text(body, 'documentDate');
    _reason.text = text(body, 'reason');
    _party.text = text(body, 'counterpartyName');
    _notes.text = text(body, 'notes');
    _dirty = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      for (final line in old) {
        line.dispose();
      }
    });
  }

  @override
  void dispose() {
    widget.exitRelay?.detach(_confirmExit);
    _date.dispose();
    _reason.dispose();
    _party.dispose();
    _notes.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  /// The number a `Decimal` should be written back as: plain digits, with the
  /// trailing zeros a parsed `1.000000` carries removed.
  ///
  /// `Decimal.toString()` keeps the scale it was built with, so writing it
  /// straight into the quantity box would show `1.000000` as if the operator
  /// had typed it.
  static String _plainDecimal(Decimal value) {
    final rounded = value.round(scale: 4);
    var text = rounded.toString();
    if (!text.contains('.')) return text;
    text = text.replaceFirst(RegExp(r'0+$'), '');
    return text.endsWith('.')
        ? text.substring(0, text.length - 1)
        : text;
  }

  /// The conversion factor of [unitName] on [item], or null when the item does
  /// not describe that unit.
  ///
  /// This is only ever used to *show* an equivalent; it is never applied to the
  /// quantity that is posted. The server owns the conversion.
  static Decimal? _factorOfUnit(Json? item, String? unitName) {
    if (item == null || unitName == null || unitName.isEmpty) return null;
    final raw = item['units'];
    if (raw is! List) return unitName == text(item, 'unit') ? Decimal.one : null;
    for (final row in raw) {
      if (row is! Map) continue;
      if (text(row, 'unit') != unitName) continue;
      final factor = Decimal.tryParse(text(row, 'factor').trim());
      if (factor != null && factor > Decimal.zero) return factor;
    }
    // A legacy item without a units array behaves as its own base unit.
    return unitName == text(item, 'unit') ? Decimal.one : null;
  }

  /// "1 carton = 24 pieces", or null when the line selects the base unit (there
  /// the quantity already *is* the base quantity) or when the factor is
  /// unknown.
  ///
  /// Shown, never used as the posted quantity.
  String? _baseEquivalent(_VoucherLine line, Json? item) {
    final quantity = Decimal.tryParse(line.quantity.text.trim());
    final factor = _factorOfUnit(item, line.unitName);
    if (quantity == null || quantity <= Decimal.zero) return null;
    if (factor == null || factor == Decimal.one) return null;
    // The factor arrives as `24.000000`; shown as it came, the equivalent would
    // read "= 24.000000", which looks like a different number from the 24 the
    // operator knows.
    final base = _plainDecimal(quantity * factor);
    // Both languages read the same way here: the unit names come from the
    // catalogue and are not translated, so a translated frame would only
    // half-translate the sentence.
    final baseUnit = text(item!, 'unit', fallback: 'piece');
    return '${line.quantity.text.trim()} ${line.unitName} = '
        '$base $baseUnit';
  }

  void _changed() {
    if (!_dirty) setState(() => _dirty = true);
  }

  Future<bool> _confirmExit() async {
    if (_busy || _confirming) return false;
    if (!_dirty || _pending != null) return true;
    _confirming = true;
    try {
      final leave = await confirmAction(
        context,
        title: _label(context, 'تغييرات غير محفوظة', 'Unsaved changes'),
        message: _label(context, 'الخروج دون حفظ؟', 'Leave without saving?'),
        confirmLabel: _label(context, 'خروج', 'Discard'),
        destructive: true,
      );
      return leave && mounted;
    } finally {
      _confirming = false;
    }
  }

  Future<void> _close() async {
    if (await _confirmExit() && mounted) Navigator.of(context).pop();
  }

  String? _number(String? raw, {bool positive = false}) {
    final value = (raw ?? '').trim();
    final parsed = Decimal.tryParse(value);
    if (!RegExp(r'^\d+(?:\.\d{1,4})?$').hasMatch(value) ||
        parsed == null ||
        (positive && parsed <= Decimal.zero)) {
      return _label(context, 'رقم غير صالح', 'Invalid number');
    }
    return null;
  }

  Future<void> _save() async {
    if (_busy ||
        _pending != null ||
        _store == null ||
        _scope == null ||
        !(_form.currentState?.validate() ?? false)) {
      return;
    }
    final body = <String, dynamic>{
      if (!_editing) ...{'kind': 'ADJUSTMENT', 'voucherKind': widget.kind},
      if (_editing) 'expectedVersion': _editVersion,
      'documentDate': _date.text.trim(),
      'toWarehouseId': _warehouse,
      'counterpartyName': _party.text.trim(),
      'reason': _reason.text.trim(),
      if (_center != null) 'costCenterId': _center,
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      'lines': [
        for (final line in _lines)
          {
            'itemId': line.itemId,
            if (_editing && line.id != null) 'id': line.id,
            if (line.notes != null && line.notes!.trim().isNotEmpty)
              'notes': line.notes!.trim(),
            if (line.unitName != null) 'unitName': line.unitName,
            'quantity': widget.kind == 'ISSUE'
                ? '-${line.quantity.text.trim()}'
                : line.quantity.text.trim(),
            if (widget.kind == 'RECEIPT') 'unitCost': line.cost.text.trim(),
          },
      ],
    };
    setState(() => _busy = true);
    try {
      final request = await _store!.begin(
        _scope!,
        method: _editing ? 'PUT' : 'POST',
        path: _path,
        body: body,
      );
      if (mounted) await _send(request);
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send(Map<String, dynamic> request) async {
    setState(() {
      _busy = true;
      _pending = request;
    });
    try {
      if (request['method'] != (_editing ? 'PUT' : 'POST') ||
          request['path'] != _path ||
          request['body'] is! Map) {
        throw const FormatException('Invalid pending voucher');
      }
      final body = Map<String, dynamic>.from(request['body'] as Map);
      if (!_editing && body['voucherKind'] != widget.kind) {
        throw const FormatException('Invalid pending voucher kind');
      }
      final api = ref.read(apiClientProvider);
      final result = _editing
          ? await api.put(_path, body: body)
          : await api.post(_path, body: body);
      final id = text(result, 'id');
      if (_editing && id != text(widget.initialDocument!, 'id')) {
        throw const FormatException('Unexpected voucher response');
      }
      if (id.isEmpty) throw const FormatException('Voucher response has no id');
      await _store!.complete(_scope!);
      if (mounted) {
        _dirty = false;
        Navigator.of(context).pop(id);
      }
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _discardPendingAndReload() async {
    if (!_editing ||
        _busy ||
        _confirming ||
        _pending == null ||
        _store == null ||
        _scope == null) {
      return;
    }
    setState(() => _confirming = true);
    final ok = await confirmAction(
      context,
      title: _label(context, 'طلب غير محسوم', 'Unresolved request'),
      message: _label(
        context,
        'قد يكون التعديل تم حفظه. سيتم تجاهل إعادة المحاولة وإعادة تحميل الإذن من الخادم. متابعة؟',
        'The edit may have been saved. Discard the retry and reload the voucher from the server?',
      ),
      confirmLabel: _label(context, 'إعادة التحميل', 'Reload'),
      destructive: true,
    );
    if (!mounted) return;
    setState(() => _confirming = false);
    if (!ok) return;
    setState(() => _busy = true);
    try {
      await _store!.complete(_scope!);
      if (mounted) {
        _dirty = false;
        Navigator.of(context).pop();
      }
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final disabled = _busy || _confirming || _pending != null || _store == null;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            widget.kind == 'RECEIPT'
                ? _label(context, 'إذن إضافة', 'Receipt voucher')
                : _label(context, 'إذن صرف', 'Issue voucher'),
          ),
        ),
        body: FutureBuilder<List<List<Json>>>(
          future: _options,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  _VoucherLoadError(
                    error: snapshot.error!,
                    onRetry: () => setState(() {
                      _options = _loadOptions();
                    }),
                  ),
                  if (_pending != null)
                    FilledButton(
                      onPressed: _busy ? null : () => _send(_pending!),
                      child: Text(_label(context, 'إعادة المحاولة', 'Retry')),
                    ),
                ],
              );
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final items = snapshot.data![0],
                warehouses = snapshot.data![1],
                centers = snapshot.data![2];
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (_editing &&
                    (widget.initialDocument!['reviewedAt'] != null ||
                        widget.initialDocument!['approvedAt'] != null))
                  Text(
                    _label(
                      context,
                      'حفظ التعديلات يلغي المراجعة والاعتماد ويتطلب إعادة تنفيذهما.',
                      'Saving changes clears review and approval; both must be repeated.',
                    ),
                  ),
                if (_pending != null)
                  Card(
                    child: ListTile(
                      title: Text(
                        _label(
                          context,
                          'طلب الإذن غير محسوم؛ أعد المحاولة بنفس الطلب',
                          'Voucher request is unresolved; retry the same request',
                        ),
                      ),
                      trailing: Wrap(
                        spacing: 8,
                        children: [
                          FilledButton(
                            onPressed: _busy ? null : () => _send(_pending!),
                            child: Text(
                              _label(context, 'إعادة المحاولة', 'Retry'),
                            ),
                          ),
                          if (_editing)
                            TextButton(
                              onPressed: _busy
                                  ? null
                                  : _discardPendingAndReload,
                              child: Text(
                                _label(context, 'إعادة التحميل', 'Reload'),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                Form(
                  key: _form,
                  child: IgnorePointer(
                    ignoring: disabled,
                    child: Column(
                      children: [
                        DropdownButtonFormField<String>(
                          initialValue:
                              warehouses.any((x) => text(x, 'id') == _warehouse)
                              ? _warehouse
                              : null,
                          decoration: InputDecoration(
                            labelText: _label(context, 'المخزن', 'Warehouse'),
                          ),
                          items: [
                            for (final row in warehouses)
                              DropdownMenuItem(
                                value: text(row, 'id'),
                                child: Text(
                                  '${text(row, 'code')} • ${_localizedName(context, row)}',
                                ),
                              ),
                          ],
                          onChanged: (v) {
                            setState(() => _warehouse = v);
                            _changed();
                          },
                          validator: (v) => v == null
                              ? _label(context, 'مطلوب', 'Required')
                              : null,
                        ),
                        TextFormField(
                          controller: _date,
                          onChanged: (_) => _changed(),
                          decoration: InputDecoration(
                            labelText: _label(
                              context,
                              'التاريخ YYYY-MM-DD',
                              'Date YYYY-MM-DD',
                            ),
                          ),
                          validator: (value) {
                            final raw = (value ?? '').trim();
                            final date = DateTime.tryParse(raw);
                            return RegExp(r'^\d{4}-\d{2}-\d{2}$')
                                        .hasMatch(raw) &&
                                    date != null &&
                                    date.toIso8601String().startsWith(raw)
                                ? null
                                : _label(
                                    context,
                                    'تاريخ غير صالح',
                                    'Invalid date',
                                  );
                          },
                        ),
                        TextFormField(
                          controller: _party,
                          onChanged: (_) => _changed(),
                          decoration: InputDecoration(
                            labelText: _label(context, 'الجهة', 'Counterparty'),
                          ),
                          validator: (v) =>
                              (v ?? '').trim().isEmpty ||
                                  (v ?? '').trim().length > 200
                              ? _label(
                                  context,
                                  'مطلوب (حتى 200 حرف)',
                                  'Required (up to 200 characters)',
                                )
                              : null,
                        ),
                        TextFormField(
                          controller: _reason,
                          onChanged: (_) => _changed(),
                          decoration: InputDecoration(
                            labelText: _label(context, 'السبب', 'Reason'),
                          ),
                          validator: (v) => (v ?? '').trim().isEmpty
                              ? _label(context, 'مطلوب', 'Required')
                              : null,
                        ),
                        if (widget.kind == 'ISSUE' || centers.isNotEmpty)
                          DropdownButtonFormField<String>(
                            initialValue: _center,
                            decoration: InputDecoration(
                              labelText: widget.kind == 'ISSUE'
                                  ? _label(
                                      context,
                                      'مركز التكلفة (مطلوب)',
                                      'Cost center (required)',
                                    )
                                  : _label(
                                      context,
                                      'مركز التكلفة (اختياري)',
                                      'Cost center (optional)',
                                    ),
                            ),
                            items: [
                              if (_center != null &&
                                  !centers.any((x) => text(x, 'id') == _center))
                                DropdownMenuItem(
                                  value: _center,
                                  child: Text(
                                    _label(
                                      context,
                                      'مركز التكلفة المحفوظ',
                                      'Saved cost center',
                                    ),
                                  ),
                                ),
                              for (final row in centers)
                                DropdownMenuItem(
                                  value: text(row, 'id'),
                                  child: Text(
                                    '${text(row, 'code')} • ${_localizedName(context, row)}',
                                  ),
                                ),
                            ],
                            onChanged: (v) {
                              setState(() => _center = v);
                              _changed();
                            },
                            validator: (_) =>
                                widget.kind == 'ISSUE' && _center == null
                                ? _label(context, 'مطلوب', 'Required')
                                : null,
                          ),
                        if (widget.kind == 'ISSUE' && centers.isEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              _label(
                                context,
                                'لا توجد مراكز تكلفة نشطة متاحة للصرف.',
                                'No active cost centres are available for stock issues.',
                              ),
                            ),
                          ),
                        if (_moreCenters)
                          TextButton(
                            onPressed: _loadingMore
                                ? null
                                : () => _loadMore(snapshot.data!, items: false),
                            child: Text(
                              _label(
                                context,
                                'تحميل المزيد من مراكز التكلفة',
                                'Load more cost centers',
                              ),
                            ),
                          ),
                        TextFormField(
                          controller: _notes,
                          onChanged: (_) => _changed(),
                          decoration: InputDecoration(
                            labelText: _label(context, 'ملاحظات', 'Notes'),
                          ),
                        ),
                        for (final line in _lines)
                          Builder(
                            key: ObjectKey(line),
                            builder: (context) {
                              final item = items
                                  .where(
                                    (row) => text(row, 'id') == line.itemId,
                                  )
                                  .firstOrNull;
                              final rawUnits = item?['units'];
                              final units =
                                  (rawUnits is List && rawUnits.isNotEmpty
                                          ? rawUnits.cast<Json>().where(
                                              (unit) => flag(
                                                unit,
                                                'isActive',
                                                fallback: true,
                                              ),
                                            )
                                          : lineUnitsOf(item))
                                      .where(
                                        (unit) => text(unit, 'unit').isNotEmpty,
                                      )
                                      .toList();
                              // An unchanged saved line retains its frozen unit, even if the
                              // catalogue later disabled it. New selections remain active-only.
                              if (line.id != null &&
                                  line.itemId == line.originalItemId &&
                                  line.unitName != null &&
                                  line.unitName == line.originalUnitName &&
                                  !units.any(
                                    (unit) =>
                                        text(unit, 'unit') == line.unitName,
                                  )) {
                                units.add({'unit': line.unitName});
                              }
                              return Card(
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    children: [
                                      TextFormField(
                                        controller: line.barcode,
                                        decoration: InputDecoration(
                                          labelText: _label(
                                            context,
                                            'مسح باركود الصنف أو الوحدة',
                                            'Scan item or unit barcode',
                                          ),
                                        ),
                                        onFieldSubmitted: (value) =>
                                            _scanBarcode(
                                              line,
                                              value,
                                              snapshot.data![0],
                                            ),
                                      ),
                                      DropdownButtonFormField<String>(
                                        initialValue:
                                            items.any(
                                              (x) =>
                                                  text(x, 'id') == line.itemId,
                                            )
                                            ? line.itemId
                                            : null,
                                        decoration: InputDecoration(
                                          labelText: _label(
                                            context,
                                            'الصنف',
                                            'Item',
                                          ),
                                        ),
                                        items: [
                                          for (final row in items)
                                            DropdownMenuItem(
                                              value: text(row, 'id'),
                                              child: Text(
                                                '${text(row, 'code')} • ${_localizedName(context, row)}',
                                              ),
                                            ),
                                        ],
                                        onChanged: (v) {
                                          setState(() {
                                            line.itemId = v;
                                            line.unitName = null;
                                          });
                                          _changed();
                                        },
                                        validator: (v) => v == null
                                            ? _label(
                                                context,
                                                'مطلوب',
                                                'Required',
                                              )
                                            : null,
                                      ),
                                      if (item != null &&
                                          (units.isNotEmpty ||
                                              line.unitName != null))
                                        DropdownButtonFormField<String>(
                                          key: ValueKey(
                                            'voucher-unit-${line.itemId}-${line.unitName}',
                                          ),
                                          initialValue:
                                              units.any(
                                                (unit) =>
                                                    text(unit, 'unit') ==
                                                    line.unitName,
                                              )
                                              ? line.unitName
                                              : null,
                                          decoration: InputDecoration(
                                            labelText: _label(
                                              context,
                                              'الوحدة (الأساسية افتراضيًا)',
                                              'Unit (base by default)',
                                            ),
                                          ),
                                          items: [
                                            for (final unit in units)
                                              DropdownMenuItem(
                                                value: text(unit, 'unit'),
                                                child: Text(text(unit, 'unit')),
                                              ),
                                          ],
                                          onChanged: (v) {
                                            setState(() => line.unitName = v);
                                            _changed();
                                          },
                                          validator: (_) =>
                                              line.unitName != null &&
                                                  !units.any(
                                                    (unit) =>
                                                        text(unit, 'unit') ==
                                                        line.unitName,
                                                  )
                                              ? _label(
                                                  context,
                                                  'اختر وحدة صالحة',
                                                  'Select an active unit',
                                                )
                                              : null,
                                        ),
                                      TextFormField(
                                        controller: line.quantity,
                                        onChanged: (_) => _changed(),
                                        keyboardType: TextInputType.number,
                                        decoration: InputDecoration(
                                          labelText: line.unitName == null
                                              ? _label(
                                                  context,
                                                  'الكمية بالوحدة الأساسية',
                                                  'Quantity in base units',
                                                )
                                              : _label(
                                                  context,
                                                  'الكمية بالوحدة المختارة',
                                                  'Quantity in selected unit',
                                                ),
                                        ),
                                        validator: (v) =>
                                            _number(v, positive: true),
                                      ),
                                      if (_baseEquivalent(line, item)
                                          case final equivalent?)
                                        Padding(
                                          padding: const EdgeInsets.only(
                                            top: 4,
                                            left: 12,
                                            right: 12,
                                          ),
                                          child: Align(
                                            alignment: AlignmentDirectional
                                                .centerStart,
                                            child: Text(
                                              equivalent,
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .bodySmall
                                                  ?.copyWith(
                                                    color: Theme.of(context)
                                                        .colorScheme
                                                        .onSurfaceVariant,
                                                  ),
                                            ),
                                          ),
                                        ),
                                      if (widget.kind == 'RECEIPT')
                                        TextFormField(
                                          controller: line.cost,
                                          onChanged: (_) => _changed(),
                                          keyboardType: TextInputType.number,
                                          decoration: InputDecoration(
                                            labelText: _label(
                                              context,
                                              'تكلفة الوحدة الأساسية',
                                              'Base unit cost',
                                            ),
                                          ),
                                          validator: _number,
                                        ),
                                      TextFormField(
                                        initialValue: line.notes,
                                        onChanged: (value) {
                                          line.notes = value;
                                          _changed();
                                        },
                                        decoration: InputDecoration(
                                          labelText: _label(
                                            context,
                                            'ملاحظات السطر',
                                            'Line notes',
                                          ),
                                        ),
                                      ),
                                      if (_lines.length > 1)
                                        TextButton(
                                          onPressed: () {
                                            setState(() => _lines.remove(line));
                                            _changed();
                                            WidgetsBinding.instance
                                                .addPostFrameCallback(
                                                  (_) => line.dispose(),
                                                );
                                          },
                                          child: Text(
                                            _label(
                                              context,
                                              'حذف السطر',
                                              'Remove line',
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                        TextButton.icon(
                          onPressed: () {
                            setState(() => _lines.add(_VoucherLine()));
                            _changed();
                          },
                          icon: const Icon(Icons.add),
                          label: Text(_label(context, 'إضافة صنف', 'Add item')),
                        ),
                        if (_moreItems)
                          TextButton(
                            onPressed: _loadingMore
                                ? null
                                : () => _loadMore(snapshot.data!, items: true),
                            child: Text(
                              _label(
                                context,
                                'تحميل المزيد من الأصناف',
                                'Load more items',
                              ),
                            ),
                          ),
                        FilledButton(
                          onPressed: disabled ? null : _save,
                          child: Text(
                            _label(context, 'حفظ المسودة', 'Save draft'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
