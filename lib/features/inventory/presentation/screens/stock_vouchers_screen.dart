import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../orders/presentation/order_retry_store.dart';
import '../../../data/presentation/widgets/document_export_actions.dart';
import '../providers/stock_providers.dart';
import '../../../accounting/presentation/screens/journal_entries_screen.dart';

const _base = '/inventory/stock-documents';
String _label(BuildContext context, String ar, String en) =>
    Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

/// The list is sourced from the server after every action, not an optimistic
/// local status. Pagination prevents old vouchers from silently disappearing.
class StockVouchersScreen extends ConsumerStatefulWidget {
  const StockVouchersScreen({super.key});
  @override
  ConsumerState<StockVouchersScreen> createState() => _StockVouchersScreenState();
}

class _StockVouchersScreenState extends ConsumerState<StockVouchersScreen> {
  int _page = 1;
  late Future<Json> _future;
  @override
  void initState() { super.initState(); _future = _load(); }
  Future<Json> _load() {
    final branchId=ref.read(currentUserProvider)?.branchId;
    if (branchId == null) throw StateError('No user branch');
    return ref.read(apiClientProvider).getObject(_base, query:{'page':_page,'pageSize':50,'branchId':branchId,'voucherOnly':'true'});
  }
  void _refresh() => setState(() { _future = _load(); });
  Future<void> _create(String kind) async {
    await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => StockVoucherCreateScreen(kind:kind)));
    if (mounted) _refresh();
  }
  Future<void> _detail(String id) async {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => StockVoucherDetailScreen(id:id)));
    if (mounted) _refresh();
  }
  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final canCreate = user?.can('inventory.stock.adjust') ?? false;
    final canPrepare = canCreate && (user?.can('inventory.items.read') ?? false) && (user?.can('inventory.warehouses.read') ?? false);
    final canSeeCost = user?.can('inventory.cost.read') ?? false;
    return Scaffold(appBar:AppBar(title:Text(_label(context,'أذون المخزون','Stock vouchers'))),
      body:Column(children:[
        Wrap(spacing:8,children:[
          if (canPrepare && canSeeCost) FilledButton(onPressed:() => _create('RECEIPT'), child:Text(_label(context,'إذن إضافة','New receipt'))),
          if (canPrepare) FilledButton(onPressed:() => _create('ISSUE'), child:Text(_label(context,'إذن صرف','New issue'))),
          if (canCreate && !canPrepare) Text(_label(context,'يلزم صلاحية قراءة الأصناف والمخازن لإنشاء إذن','Item and warehouse read permissions are required to create a voucher')),
          IconButton(onPressed:_refresh,icon:const Icon(Icons.refresh),tooltip:_label(context,'تحديث','Refresh')),
        ]),
        Expanded(child:FutureBuilder<Json>(future:_future,builder:(context,snapshot) {
          if (snapshot.hasError) return Center(child:Text('${snapshot.error}'));
          if (!snapshot.hasData) return const Center(child:CircularProgressIndicator());
          final data = snapshot.data!;
          final rows = listOf(data['items']).where((row) => text(row,'voucherKind').isNotEmpty).toList();
          final total = (data['total'] as num?)?.toInt() ?? 0;
          return Column(children:[
            Expanded(child:rows.isEmpty ? Center(child:Text(_label(context,'لا توجد أذون في هذه الصفحة','No vouchers on this page'))) : ListView(
              children:[for (final row in rows) ListTile(
                title:Text('${text(row,'documentNumber')} • ${text(row,'voucherKind')}'),
                subtitle:Text('${text(row,'documentDate')} • ${text(row,'status')} • ${text(row,'counterpartyName')}'),
                onTap:() => _detail(text(row,'id')),
              )],
            )),
            Row(mainAxisAlignment:MainAxisAlignment.center,children:[
              TextButton(onPressed:_page > 1 ? () { _page--; _refresh(); } : null,child:Text(_label(context,'السابق','Previous'))),
              Text('$_page'),
              TextButton(onPressed:_page * 50 < total ? () { _page++; _refresh(); } : null,child:Text(_label(context,'التالي','Next'))),
            ]),
          ]);
        })),
      ]));
  }
}

class StockVoucherDetailScreen extends ConsumerStatefulWidget {
  const StockVoucherDetailScreen({super.key,required this.id});
  final String id;
  @override
  ConsumerState<StockVoucherDetailScreen> createState() => _StockVoucherDetailScreenState();
}
class _StockVoucherDetailScreenState extends ConsumerState<StockVoucherDetailScreen> {
  late Future<Json> _future;
  bool _busy = false, _confirming = false;
  @override
  void initState() { super.initState(); _future = _load(); }
  Future<Json> _load() => ref.read(apiClientProvider).getObject('$_base/${widget.id}');
  void _refresh() => setState(() { _future = _load(); });
  Future<void> _action(String action) async {
    if (_busy || _confirming) return;
    setState(() => _confirming = true);
    final ok = await confirmAction(context,title:_label(context,'تأكيد العملية','Confirm action'),
      message:_label(context,'هل تريد تنفيذ العملية؟','Proceed with this action?'),
      confirmLabel:_label(context,'تأكيد','Confirm'),destructive:action == 'reverse');
    if (!mounted) return;
    setState(() => _confirming = false);
    if (!ok) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).post('$_base/${widget.id}/$action',body:{});
      if (mounted) { _refresh(); showMessage(context,_label(context,'تم تحديث الإذن','Voucher refreshed')); }
    } catch (error) {
      if (mounted) { _refresh(); showMessage(context,error is Failure ? error.message : '$error',error:true); }
    } finally {
      if (mounted) {
        if (action == 'post' || action == 'reverse') {
          // A failed network response can still follow a committed transaction.
          ref.invalidate(stockListProvider);
          ref.invalidate(journalEntriesProvider);
        }
        setState(() => _busy = false);
      }
    }
  }
  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    bool can(String permission) => user?.can(permission) ?? false;
    return Scaffold(appBar:AppBar(title:Text(_label(context,'تفاصيل الإذن','Voucher details'))),
      body:FutureBuilder<Json>(future:_future,builder:(context,snapshot) {
        if (snapshot.hasError) return Center(child:Text('${snapshot.error}'));
        if (!snapshot.hasData) return const Center(child:CircularProgressIndicator());
        final doc=snapshot.data!; final status=text(doc,'status').toLowerCase();
        final reviewed=asString(doc['reviewedAt']) != null, approved=asString(doc['approvedAt']) != null;
        return ListView(padding:const EdgeInsets.all(20),children:[
          Text('${text(doc,'documentNumber')} • ${text(doc,'voucherKind')} • $status',style:Theme.of(context).textTheme.titleLarge),
          Text('${_label(context,'التاريخ','Date')}: ${text(doc,'documentDate')}'),
          Text('${_label(context,'الجهة','Counterparty')}: ${text(doc,'counterpartyName')}'),
          Text('${_label(context,'السبب','Reason')}: ${text(doc,'reason')}'),
          Text('${_label(context,'المخزن','Warehouse')}: ${doc['toWarehouse'] is Map ? text(Map<String,dynamic>.from(doc['toWarehouse'] as Map),'nameAr',fallback:text(Map<String,dynamic>.from(doc['toWarehouse'] as Map),'nameEn')) : text(doc,'toWarehouseId')}'),
          Text('${_label(context,'مركز التكلفة','Cost center')}: ${doc['costCenter'] is Map ? text(Map<String,dynamic>.from(doc['costCenter'] as Map),'nameAr',fallback:text(Map<String,dynamic>.from(doc['costCenter'] as Map),'nameEn')) : '—'}'),
          Text('${_label(context,'ملاحظات','Notes')}: ${text(doc,'notes',fallback:'—')}'),
          Text('${_label(context,'القيد','Journal entry')}: ${text(doc,'journalEntryId',fallback:'—')}'),
          Text('${_label(context,'المراجعة','Reviewed')}: ${text(doc,'reviewedAt',fallback:'—')}'),
          Text('${_label(context,'الاعتماد','Approved')}: ${text(doc,'approvedAt',fallback:'—')}'),
          for (final line in listOf(doc['lines'])) ListTile(
            title:Text('${text(line,'itemCode')} • ${text(line,'itemNameAr',fallback:text(line,'itemNameEn'))}'),
            subtitle:Text('${_label(context,'الكمية','Quantity')}: ${text(line,'unitQuantity',fallback:text(line,'quantity'))} • ${text(line,'unit')}'),
            trailing:can('inventory.cost.read') ? Text('${_label(context,'تكلفة الوحدة الأساسية','Base unit cost')}: ${text(line,'unitCost')}') : null,
          ),
          if (can('admin.audit.read')) _VoucherHistory(key:ValueKey('${widget.id}:$status:$reviewed:$approved'),id:widget.id),
          if (can('inventory.export')) DocumentExportActions(kind:'stock-voucher',id:widget.id),
          Wrap(spacing:8,children:[
            if (status == 'draft' && !reviewed && can('inventory.stock.review'))
              OutlinedButton(onPressed:_busy || _confirming ? null : () => _action('review'),child:Text(_label(context,'مراجعة','Review'))),
            if (status == 'draft' && reviewed && !approved && can('inventory.stock.approve'))
              OutlinedButton(onPressed:_busy || _confirming ? null : () => _action('approve'),child:Text(_label(context,'اعتماد','Approve'))),
            if (status == 'draft' && approved && can('inventory.stock.adjust'))
              FilledButton(onPressed:_busy || _confirming ? null : () => _action('post'),child:Text(_label(context,'ترحيل','Post'))),
            if (status == 'posted' && can('inventory.stock.adjust'))
              OutlinedButton(onPressed:_busy || _confirming ? null : () => _action('reverse'),child:Text(_label(context,'عكس','Reverse'))),
          ]),
        ]);
      }));
  }
}

class _VoucherHistory extends ConsumerStatefulWidget {
  const _VoucherHistory({super.key,required this.id});
  final String id;
  @override
  ConsumerState<_VoucherHistory> createState() => _VoucherHistoryState();
}
class _VoucherHistoryState extends ConsumerState<_VoucherHistory> {
  late Future<List<Json>> _future;
  @override
  void initState() { super.initState(); _future = _load(); }
  Future<List<Json>> _load() => ref.read(apiClientProvider).getList('/admin/audit-logs',
    query:{'entity':'stock_documents','entityId':widget.id,'pageSize':200});
  @override
  Widget build(BuildContext context) => ExpansionTile(title:Text(_label(context,'السجل','History')),
    children:[FutureBuilder<List<Json>>(future:_future,builder:(context,snapshot) {
      if (snapshot.hasError) return Text('${snapshot.error}');
      if (!snapshot.hasData) return const CircularProgressIndicator();
      return Column(children:[for (final event in snapshot.data!) ListTile(
        title:Text(text(event,'action')),subtitle:Text('${text(event,'createdAt')} • ${text(event,'userId')}'))]);
    })]);
}

class _VoucherLine {
  String? itemId;
  final quantity=TextEditingController();
  final cost=TextEditingController();
  void dispose() { quantity.dispose(); cost.dispose(); }
}

/// A retained request always keeps the original body/key until a successful
/// replay. Ambiguous failures, including conflicts, are never discarded.
class StockVoucherCreateScreen extends ConsumerStatefulWidget {
  const StockVoucherCreateScreen({super.key,required this.kind});
  final String kind;
  @override
  ConsumerState<StockVoucherCreateScreen> createState() => _StockVoucherCreateScreenState();
}
class _StockVoucherCreateScreenState extends ConsumerState<StockVoucherCreateScreen> {
  final _form=GlobalKey<FormState>();
  final _date=TextEditingController(), _reason=TextEditingController(), _party=TextEditingController(), _notes=TextEditingController();
  final _lines=<_VoucherLine>[_VoucherLine()];
  String? _warehouse, _center, _scope;
  OrderRetryStore? _store;
  Map<String,dynamic>? _pending;
  late Future<List<List<Json>>> _options;
  bool _busy=false, _dirty=false, _confirming=false, _loadingMore=false;
  bool _moreItems=false, _moreCenters=false;
  int _itemPage=1, _centerPage=1;
  @override
  void initState() {
    super.initState();
    final now=DateTime.now();
    _date.text='${now.year.toString().padLeft(4,'0')}-${now.month.toString().padLeft(2,'0')}-${now.day.toString().padLeft(2,'0')}';
    _options=_loadOptions(); _loadPending();
  }
  Future<List<List<Json>>> _loadOptions() async {
    final user=ref.read(currentUserProvider); final api=ref.read(apiClientProvider);
    if (user?.branchId == null) throw StateError('No user branch');
    final centers=(user?.can('accounting.costcenters.read') ?? false)
      ? api.getList('/accounting/cost-centers',query:{'pageSize':100,'page':1}) : Future.value(<Json>[]);
    final options=await Future.wait([api.getList('/inventory/items',query:{'pageSize':200,'page':1}),
      api.getList('/inventory/warehouses',query:{'branchId':user!.branchId}),centers]);
    _moreItems=options[0].length == 200;
    _moreCenters=options[2].length == 100;
    return options;
  }
  Future<void> _loadMore(List<List<Json>> options,{required bool items}) async {
    if (_loadingMore) return;
    setState(() => _loadingMore=true);
    try {
      final page=(items ? _itemPage : _centerPage) + 1;
      final rows=await ref.read(apiClientProvider).getList(items ? '/inventory/items' : '/accounting/cost-centers',
        query:{'pageSize':items ? 200 : 100,'page':page});
      if (!mounted) return;
      setState(() {
        if (items) { _itemPage=page; _moreItems=rows.length == 200; }
        else { _centerPage=page; _moreCenters=rows.length == 100; }
        final index=items ? 0 : 2;
        final ids=options[index].map((row) => text(row,'id')).toSet();
        final additions=rows.where((row) => ids.add(text(row,'id')));
        final updated=[...options];
        updated[index]=[...options[index],...additions];
        _options=Future.value(updated);
      });
    } catch (error) {
      if (mounted) showMessage(context,error is Failure ? error.message : '$error',error:true);
    } finally { if (mounted) setState(() => _loadingMore=false); }
  }
  Future<void> _loadPending() async {
    try {
      final user=ref.read(currentUserProvider); if (user?.branchId == null) throw StateError('No user branch');
      final config=ref.read(appConfigProvider);
      final scope=orderRetryScope(apiBaseUrl:config.apiBaseUrl,embeddedLocalServer:config.embeddedLocalServer,
        companyId:user!.companyId,branchId:user.branchId!,userId:user.id,kind:'stock-voucher',orderId:widget.kind);
      final store=OrderRetryStore(await SharedPreferences.getInstance());
      final pending=store.read(scope);
      if (!mounted) return;
      if (pending != null) _restore(pending);
      setState(() { _store=store; _scope=scope; _pending=pending; });
    } catch (error) { if (mounted) showMessage(context,'$error',error:true); }
  }
  void _restore(Map<String,dynamic> request) {
    if (request['method'] != 'POST' || request['path'] != _base || request['body'] is! Map) throw const FormatException('Invalid pending voucher');
    final body=Map<String,dynamic>.from(request['body'] as Map);
    if (body['voucherKind'] != widget.kind) throw const FormatException('Invalid pending voucher kind');
    final raw=listOf(body['lines']); if (raw.isEmpty) throw const FormatException('Invalid pending voucher lines');
    final old=List<_VoucherLine>.from(_lines);
    _lines.clear();
    for (final row in raw) {
      final line=_VoucherLine()..itemId=asString(row['itemId']);
      line.quantity.text=text(row,'quantity').replaceFirst(RegExp(r'^-'),'');
      line.cost.text=text(row,'unitCost'); _lines.add(line);
    }
    _warehouse=asString(body['toWarehouseId']); _center=asString(body['costCenterId']);
    _date.text=text(body,'documentDate'); _reason.text=text(body,'reason');
    _party.text=text(body,'counterpartyName'); _notes.text=text(body,'notes'); _dirty=true;
    WidgetsBinding.instance.addPostFrameCallback((_) { for (final line in old) { line.dispose(); } });
  }
  @override
  void dispose() { _date.dispose(); _reason.dispose(); _party.dispose(); _notes.dispose(); for (final line in _lines) { line.dispose(); } super.dispose(); }
  void _changed() { if (!_dirty) setState(() => _dirty=true); }
  Future<void> _close() async {
    if (_busy || _confirming) return;
    if (_dirty && _pending == null) {
      _confirming=true;
      final leave=await confirmAction(context,title:_label(context,'تغييرات غير محفوظة','Unsaved changes'),
        message:_label(context,'الخروج دون حفظ؟','Leave without saving?'),confirmLabel:_label(context,'خروج','Discard'),destructive:true);
      _confirming=false; if (!leave || !mounted) return;
    }
    if (mounted) Navigator.of(context).pop();
  }
  String? _number(String? raw,{bool positive=false}) {
    final value=(raw ?? '').trim(); final parsed=Decimal.tryParse(value);
    if (!RegExp(r'^\d+(?:\.\d{1,4})?$').hasMatch(value) || parsed == null || (positive && parsed <= Decimal.zero)) {
      return _label(context,'رقم غير صالح','Invalid number');
    }
    return null;
  }
  Future<void> _save() async {
    if (_busy || _pending != null || _store == null || _scope == null || !(_form.currentState?.validate() ?? false)) return;
    final body=<String,dynamic>{'kind':'ADJUSTMENT','voucherKind':widget.kind,'documentDate':_date.text.trim(),
      'toWarehouseId':_warehouse,'counterpartyName':_party.text.trim(),'reason':_reason.text.trim(),
      if (_center != null) 'costCenterId':_center,
      if (_notes.text.trim().isNotEmpty) 'notes':_notes.text.trim(),
      'lines':[for (final line in _lines) {'itemId':line.itemId,
        'quantity':widget.kind == 'ISSUE' ? '-${line.quantity.text.trim()}' : line.quantity.text.trim(),
        if (widget.kind == 'RECEIPT') 'unitCost':line.cost.text.trim()}]};
    setState(() => _busy=true);
    try { final request=await _store!.begin(_scope!,method:'POST',path:_base,body:body); if (mounted) await _send(request); }
    catch (error) { if (mounted) showMessage(context,'$error',error:true); }
    finally { if (mounted) setState(() => _busy=false); }
  }
  Future<void> _send(Map<String,dynamic> request) async {
    setState(() { _busy=true; _pending=request; });
    try {
      if (request['method'] != 'POST' || request['path'] != _base || request['body'] is! Map) throw const FormatException('Invalid pending voucher');
      final body=Map<String,dynamic>.from(request['body'] as Map);
      if (body['voucherKind'] != widget.kind) throw const FormatException('Invalid pending voucher kind');
      final result=await ref.read(apiClientProvider).post(_base,body:body); final id=text(result,'id');
      if (id.isEmpty) throw const FormatException('Voucher response has no id');
      await _store!.complete(_scope!);
      if (mounted) { _dirty=false; Navigator.of(context).pop(id); }
    } catch (error) { if (mounted) showMessage(context,error is Failure ? error.message : '$error',error:true); }
    finally { if (mounted) setState(() => _busy=false); }
  }
  @override
  Widget build(BuildContext context) {
    final disabled=_busy || _pending != null || _store == null;
    return PopScope(canPop:false,onPopInvokedWithResult:(didPop,_) { if (!didPop) _close(); },
      child:Scaffold(appBar:AppBar(title:Text(widget.kind == 'RECEIPT' ? _label(context,'إذن إضافة','Receipt voucher') : _label(context,'إذن صرف','Issue voucher'))),
        body:FutureBuilder<List<List<Json>>>(future:_options,builder:(context,snapshot) {
          if (snapshot.hasError) {
            return ListView(padding:const EdgeInsets.all(20),children:[
              Text('${snapshot.error}'),
              if (_pending != null) FilledButton(onPressed:_busy ? null : () => _send(_pending!),child:Text(_label(context,'إعادة المحاولة','Retry'))),
            ]);
          }
          if (!snapshot.hasData) return const Center(child:CircularProgressIndicator());
          final items=snapshot.data![0], warehouses=snapshot.data![1], centers=snapshot.data![2];
          return ListView(padding:const EdgeInsets.all(20),children:[
            if (_pending != null) Card(child:ListTile(title:Text(_label(context,'طلب الإذن غير محسوم؛ أعد المحاولة بنفس الطلب','Voucher request is unresolved; retry the same request')),
              trailing:FilledButton(onPressed:_busy ? null : () => _send(_pending!),child:Text(_label(context,'إعادة المحاولة','Retry'))))),
            Form(key:_form,child:IgnorePointer(ignoring:disabled,child:Column(children:[
              DropdownButtonFormField<String>(initialValue:warehouses.any((x) => text(x,'id') == _warehouse) ? _warehouse : null,
                decoration:InputDecoration(labelText:_label(context,'المخزن','Warehouse')),
                items:[for (final row in warehouses) DropdownMenuItem(value:text(row,'id'),child:Text('${text(row,'code')} • ${text(row,'nameAr',fallback:text(row,'nameEn'))}'))],
                onChanged:(v) { setState(() => _warehouse=v); _changed(); },validator:(v) => v == null ? _label(context,'مطلوب','Required') : null),
              TextFormField(controller:_date,onChanged:(_) => _changed(),decoration:InputDecoration(labelText:_label(context,'التاريخ YYYY-MM-DD','Date YYYY-MM-DD')),
                validator:(value) { final raw=(value ?? '').trim(); final date=DateTime.tryParse(raw);
                  return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(raw) && date != null && date.toIso8601String().startsWith(raw) ? null : _label(context,'تاريخ غير صالح','Invalid date'); }),
              TextFormField(controller:_party,onChanged:(_) => _changed(),decoration:InputDecoration(labelText:_label(context,'الجهة','Counterparty')),
                validator:(v) => (v ?? '').trim().isEmpty || (v ?? '').trim().length > 200 ? _label(context,'مطلوب (حتى 200 حرف)','Required (up to 200 characters)') : null),
              TextFormField(controller:_reason,onChanged:(_) => _changed(),decoration:InputDecoration(labelText:_label(context,'السبب','Reason')),
                validator:(v) => (v ?? '').trim().isEmpty ? _label(context,'مطلوب','Required') : null),
              if (centers.isNotEmpty) DropdownButtonFormField<String>(initialValue:centers.any((x) => text(x,'id') == _center) ? _center : null,
                decoration:InputDecoration(labelText:_label(context,'مركز التكلفة (اختياري)','Cost center (optional)')),
                items:[for (final row in centers) DropdownMenuItem(value:text(row,'id'),child:Text('${text(row,'code')} • ${text(row,'nameAr',fallback:text(row,'nameEn'))}'))],
                onChanged:(v) { setState(() => _center=v); _changed(); }),
              if (_moreCenters) TextButton(onPressed:_loadingMore ? null : () => _loadMore(snapshot.data!,items:false),
                child:Text(_label(context,'تحميل المزيد من مراكز التكلفة','Load more cost centers'))),
              TextFormField(controller:_notes,onChanged:(_) => _changed(),decoration:InputDecoration(labelText:_label(context,'ملاحظات','Notes'))),
              for (final line in _lines) Card(child:Padding(padding:const EdgeInsets.all(12),child:Column(children:[
                DropdownButtonFormField<String>(initialValue:items.any((x) => text(x,'id') == line.itemId) ? line.itemId : null,
                  decoration:InputDecoration(labelText:_label(context,'الصنف','Item')),
                  items:[for (final row in items) DropdownMenuItem(value:text(row,'id'),child:Text('${text(row,'code')} • ${text(row,'nameAr',fallback:text(row,'nameEn'))}'))],
                  onChanged:(v) { setState(() => line.itemId=v); _changed(); },validator:(v) => v == null ? _label(context,'مطلوب','Required') : null),
                TextFormField(controller:line.quantity,onChanged:(_) => _changed(),keyboardType:TextInputType.number,
                  decoration:InputDecoration(labelText:_label(context,'الكمية بالوحدة الأساسية','Quantity in base units')),validator:(v) => _number(v,positive:true)),
                if (widget.kind == 'RECEIPT') TextFormField(controller:line.cost,onChanged:(_) => _changed(),keyboardType:TextInputType.number,
                  decoration:InputDecoration(labelText:_label(context,'تكلفة الوحدة الأساسية','Base unit cost')),validator:_number),
                if (_lines.length > 1) TextButton(onPressed:() {
                  setState(() => _lines.remove(line)); _changed();
                  WidgetsBinding.instance.addPostFrameCallback((_) => line.dispose());
                },child:Text(_label(context,'حذف السطر','Remove line'))),
              ]))),
              TextButton.icon(onPressed:() { setState(() => _lines.add(_VoucherLine())); _changed(); },icon:const Icon(Icons.add),label:Text(_label(context,'إضافة صنف','Add item'))),
              if (_moreItems) TextButton(onPressed:_loadingMore ? null : () => _loadMore(snapshot.data!,items:true),
                child:Text(_label(context,'تحميل المزيد من الأصناف','Load more items'))),
              FilledButton(onPressed:disabled ? null : _save,child:Text(_label(context,'حفظ المسودة','Save draft'))),
            ]))),
          ]);
        })));
  }
}
