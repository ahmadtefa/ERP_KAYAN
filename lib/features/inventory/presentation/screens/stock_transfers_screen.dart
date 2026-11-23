import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/network/api_client.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/barcode/barcode_scan.dart';

final stockTransfersProvider = AsyncNotifierProvider<StockTransfersController,List<Json>>(StockTransfersController.new);
class StockTransfersController extends AsyncNotifier<List<Json>> {
  @override Future<List<Json>> build()=>ref.read(apiClientProvider).getList('/inventory/stock-transfers');
  Future<void> reload() async { state=const AsyncLoading(); state=await AsyncValue.guard(()=>ref.read(apiClientProvider).getList('/inventory/stock-transfers')); }
}

class StockTransfersScreen extends ConsumerStatefulWidget {
  const StockTransfersScreen({super.key});
  @override ConsumerState<StockTransfersScreen> createState()=>_StockTransfersScreenState();
}
class _StockTransfersScreenState extends ConsumerState<StockTransfersScreen> {
  bool _busy=false; String _query=''; String? _lastNotificationTransfer; bool get ar=>Localizations.localeOf(context).languageCode=='ar';
  String t(String a,String e)=>ar?a:e;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final transferId = GoRouterState.of(context).uri.queryParameters['transferId'];
    if (transferId == null || transferId.isEmpty) {
      _lastNotificationTransfer = null;
      return;
    }
    if (_lastNotificationTransfer == transferId) return;
    _lastNotificationTransfer = transferId;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_openNotificationTransfer(transferId));
    });
  }
  Future<void> _openNotificationTransfer(String id) async {
    await _details({'id': id});
    if (!mounted) return;
    if (GoRouterState.of(context).uri.queryParameters['transferId'] == id) {
      context.go('/inventory/stock-transfers');
    }
  }
  @override Widget build(BuildContext context) {
    final rows=ref.watch(stockTransfersProvider); final user=ref.watch(currentUserProvider);
    return ModuleScaffold(title:t('التحويلات المخزنية','Stock transfers'),eyebrow:t('المخزون','Inventory'),trailing:Wrap(spacing:8,crossAxisAlignment:WrapCrossAlignment.center,children:[
      SizedBox(width:190,child:TextField(decoration:InputDecoration(prefixIcon:const Icon(Icons.search),hintText:t('بحث','Search'),isDense:true),onChanged:(v)=>setState(()=>_query=v.trim().toLowerCase()))),
      IconButton(tooltip:t('تحديث','Refresh'),onPressed:()=>ref.read(stockTransfersProvider.notifier).reload(),icon:const Icon(Icons.refresh)),
      if(user?.can('inventory.transfer.report')??false) IconButton(tooltip:t('تقرير التحويلات والطريق','Transfer/transit report'),onPressed:_report,icon:const Icon(Icons.assessment_outlined)),
      if(user?.can('inventory.transfer.create')??false) FilledButton.icon(onPressed:_busy?null:_create,icon:const Icon(Icons.add),label:Text(t('طلب تحويل','Request transfer'))),
    ]),body:AsyncStateView<List<Json>>(value:rows,onRetry:()=>ref.read(stockTransfersProvider.notifier).reload(),isEmpty:(x)=>_visible(x).isEmpty,emptyMessage:t('لا توجد تحويلات مخزنية.','No stock transfers yet.'),data:(items)=>ListView.separated(padding:const EdgeInsets.all(12),itemCount:_visible(items).length,separatorBuilder:(_,_)=>const SizedBox(height:8),itemBuilder:(context,i){final row=_visible(items)[i];final from=row['sourceWarehouse'] as Map? ??const{},to=row['destinationWarehouse'] as Map? ??const{};return Card(child:ListTile(isThreeLine:true,title:Wrap(spacing:8,children:[Text(text(row,'documentNumber'),style:const TextStyle(fontWeight:FontWeight.bold)),Chip(label:Text(_status(text(row,'status'))),visualDensity:VisualDensity.compact)]),subtitle:Text('${ar?(from['nameAr']??from['nameEn']):(from['nameEn']??from['nameAr'])}  →  ${ar?(to['nameAr']??to['nameEn']):(to['nameEn']??to['nameAr'])}\n${text(row,'transferDate').split('T').first} · ${(row['lines'] as List? ??const[]).length} ${t('بنود','lines')}'),trailing:IconButton(tooltip:t('التفاصيل','Details'),icon:const Icon(Icons.open_in_new),onPressed:()=>_details(row))));})));}
  List<Json> _visible(List<Json> rows)=>rows.where((r)=>_query.isEmpty||'${r['documentNumber']} ${r['reason']} ${r['status']}'.toLowerCase().contains(_query)).toList();
  String _status(String s)=>switch(s){'DRAFT'=>t('مسودة','Draft'),'REVIEWED'=>t('قيد المراجعة','Reviewed'),'PENDING_APPROVAL'=>t('بانتظار الاعتماد','Pending approval'),'APPROVED'=>t('معتمد','Approved'),'DISPATCHING'=>t('جارٍ التسليم','Dispatching'),'RECEIVING'=>t('جارٍ الاستلام','Receiving'),'SETTLING'=>t('جارٍ التسوية','Settling'),'PARTIALLY_DISPATCHED'=>t('تسليم جزئي','Partially dispatched'),'DISPATCHED'=>t('تم التسليم','Dispatched'),'PARTIALLY_RECEIVED'=>t('استلام جزئي','Partially received'),'RECEIVED'=>t('تم الاستلام','Received'),'SETTLEMENT_PENDING'=>t('إعدام بانتظار الاعتماد','Write-off approval pending'),'SETTLED'=>t('تمت التسوية','Settled'),'CLOSED'=>t('مغلق','Closed'),'REJECTED'=>t('مرفوض','Rejected'),'CANCELLED'=>t('ملغى','Cancelled'),_=>s};
  Future<void> _create() async {try{final api=ref.read(apiClientProvider);final warehouses=await api.getList('/inventory/warehouses');final items=await api.getList('/inventory/items');final batches=await api.getList('/inventory/batches');if(!mounted)return;final body=await showDialog<Json>(context:context,barrierDismissible:false,builder:(_)=>_CreateTransferDialog(ar:ar,warehouses:warehouses,items:items,batches:batches,api:api));if(body==null||!mounted)return;setState(()=>_busy=true);await api.post('/inventory/stock-transfers',body:body,idempotencyKey:'create-${DateTime.now().microsecondsSinceEpoch}');await ref.read(stockTransfersProvider.notifier).reload();}catch(e){if(mounted)_msg(e.toString());}finally{if(mounted)setState(()=>_busy=false);}}
  Future<void> _details(Json row) async {final changed=await showDialog<bool>(context:context,builder:(_)=>_TransferDialog(id:text(row,'id'),ar:ar));if(changed==true&&mounted)await ref.read(stockTransfersProvider.notifier).reload();}
  Future<void> _report() async {
    try {
      final report = await ref.read(apiClientProvider).getObject(
        '/inventory/stock-transfers/report',
      );
      if (!mounted) return;
      final rows = (report['rows'] as List? ?? const [])
          .whereType<Map>()
          .toList();
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(t('تقرير التحويلات والأرصدة بالطريق', 'Transfers & transit report')),
          content: SizedBox(
            width: 760,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columns: [
                  DataColumn(label: Text(t('رقم', 'Number'))),
                  DataColumn(label: Text(t('الحالة', 'Status'))),
                  DataColumn(label: Text(t('مرسل', 'Dispatched'))),
                  DataColumn(label: Text(t('مستلم', 'Received'))),
                  DataColumn(label: Text(t('بالطريق', 'In transit'))),
                  DataColumn(label: Text(t('فروق', 'Differences'))),
                ],
                rows: rows.map((row) => DataRow(cells: [
                  DataCell(Text('${row['documentNumber']}')),
                  DataCell(Text(_status('${row['status']}'))),
                  DataCell(Text('${row['dispatched']}')),
                  DataCell(Text('${row['received']}')),
                  DataCell(Text('${row['inTransit']}')),
                  DataCell(Text('${row['differences']}')),
                ])).toList(),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(t('إغلاق', 'Close')),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) _msg(e.toString());
    }
  }
  void _msg(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s),behavior:SnackBarBehavior.floating));
}

class _DraftLine {
  String? itemId, batchId, unitName;
  final quantity = TextEditingController(text: '1');
  void dispose() => quantity.dispose();
}

class _CreateTransferDialog extends StatefulWidget {
  const _CreateTransferDialog({required this.ar, required this.warehouses, required this.items, required this.batches, required this.api});
  final bool ar;
  final List<Json> warehouses, items, batches;
  final ApiClient api;
  @override State<_CreateTransferDialog> createState() => _CreateTransferDialogState();
}

class _CreateTransferDialogState extends State<_CreateTransferDialog> {
  final _reason=TextEditingController(), _notes=TextEditingController(), _barcode=TextEditingController();
  final List<_DraftLine> _lines=[_DraftLine()];
  late final List<Json> _items=List<Json>.of(widget.items);
  String? _from,_to;
  bool _scanning=false;
  bool get ar=>widget.ar;
  String t(String a,String e)=>ar?a:e;
  @override void dispose(){_reason.dispose();_notes.dispose();_barcode.dispose();for(final line in _lines){line.dispose();}super.dispose();}

  @override Widget build(BuildContext context)=>AlertDialog(
    title:Text(t('طلب تحويل مخزني','Request stock transfer')),
    content:SizedBox(width:920,child:SingleChildScrollView(child:Column(mainAxisSize:MainAxisSize.min,children:[
      DropdownButtonFormField<String>(initialValue:_from,decoration:InputDecoration(labelText:t('من المخزن','Source warehouse')),items:widget.warehouses.map((w)=>DropdownMenuItem(value:text(w,'id'),child:Text('${text(w,'code')} · ${ar?text(w,'nameAr'):text(w,'nameEn')}'))).toList(),onChanged:(v)=>setState(()=>_from=v)),
      const SizedBox(height:8),
      DropdownButtonFormField<String>(initialValue:_to,decoration:InputDecoration(labelText:t('إلى المخزن','Destination warehouse')),items:widget.warehouses.map((w)=>DropdownMenuItem(value:text(w,'id'),child:Text('${text(w,'code')} · ${ar?text(w,'nameAr'):text(w,'nameEn')}'))).toList(),onChanged:(v)=>setState(()=>_to=v)),
      const SizedBox(height:12),
      BarcodeScanField(controller:_barcode,arabic:ar,enabled:!_scanning,label:t('مسح لإضافة صنف أو وحدة','Scan to add item or unit'),onSubmitted:_scan),
      const SizedBox(height:10),
      ..._lines.asMap().entries.map((entry){

        final index=entry.key,line=entry.value;
        final item=_items.cast<Json?>().firstWhere((x)=>x?['id']==line.itemId,orElse:()=>null);
        final units=(item?['units'] as List? ??const[]).whereType<Map>().map((e)=>Map<String,dynamic>.from(e)).where((u)=>u['isActive']!=false).toList();
        final selectedUnits=units.isNotEmpty?units:<Json>[{'unit':item?['unit']??''}];
        final lots=widget.batches.where((b)=>b['warehouseId']==_from&&b['itemId']==line.itemId&&(double.tryParse('${b['remainingQuantity']}')??0)>0).toList();
        return Padding(padding:const EdgeInsets.only(bottom:12),child:Wrap(spacing:8,runSpacing:8,children:[
          SizedBox(width:270,child:DropdownButtonFormField<String>(initialValue:line.itemId,decoration:InputDecoration(labelText:t('الصنف','Item')),items:_items.map((x){final barcode=text(x,'barcode');return DropdownMenuItem(value:text(x,'id'),child:Text('${text(x,'code')} · ${ar?text(x,'nameAr'):text(x,'nameEn')}${barcode.isNotEmpty?'  [$barcode]':''}',overflow:TextOverflow.ellipsis));}).toList(),onChanged:(v)=>setState(() {line.itemId=v;line.batchId=null;line.unitName=null;}))),
          SizedBox(width:115,child:TextField(controller:line.quantity,keyboardType:const TextInputType.numberWithOptions(decimal:true),decoration:InputDecoration(labelText:t('كمية','Quantity')))),
          if(item!=null)SizedBox(width:160,child:DropdownButtonFormField<String>(initialValue:line.unitName??text(item,'unit'),decoration:InputDecoration(labelText:t('الوحدة','Unit')),items:selectedUnits.map((u)=>DropdownMenuItem(value:'${u['unit']??text(item,'unit')}',child:Text('${u['unit']??text(item,'unit')} × ${u['factor']??1}'))).toList(),onChanged:(v)=>setState(()=>line.unitName=v))),
          if(lots.isNotEmpty)SizedBox(width:180,child:DropdownButtonFormField<String>(initialValue:line.batchId,decoration:InputDecoration(labelText:t('دفعة المصدر','Source lot')),items:lots.map((b)=>DropdownMenuItem(value:text(b,'id'),child:Text('${text(b,'batchNumber')} · ${b['remainingQuantity']}'))).toList(),onChanged:(v)=>setState(()=>line.batchId=v))),
          IconButton(tooltip:t('حذف البند','Remove line'),onPressed:_lines.length==1?null:()=>setState(()=>_lines.removeAt(index).dispose()),icon:const Icon(Icons.remove_circle_outline)),
        ]));
      }),
      Align(alignment:AlignmentDirectional.centerStart,child:TextButton.icon(onPressed:()=>setState(()=>_lines.add(_DraftLine())),icon:const Icon(Icons.add),label:Text(t('إضافة صنف','Add item')))),
      TextField(controller:_reason,decoration:InputDecoration(labelText:t('سبب التحويل','Transfer reason'))),
      TextField(controller:_notes,decoration:InputDecoration(labelText:t('ملاحظات','Notes'))),
    ]))),
    actions:[TextButton(onPressed:()=>Navigator.pop(context),child:Text(t('إلغاء','Cancel'))),FilledButton(onPressed:_save,child:Text(t('إنشاء الطلب','Create request')))],
  );
  Future<void> _scan(String raw) async {
    if(_scanning||raw.trim().isEmpty)return;
    setState(()=>_scanning=true);
    try {
      final scanner=BarcodeScanner(lookup:(code)=>widget.api.getObject('/inventory/items/by-barcode/${Uri.encodeComponent(code)}'));
      await scanner.scan(raw,arabic:ar,onFailure:(message)=>showAppPlainError(context,message),onMatch:(match) async {
        if(!mounted)return;
        setState(() {
          if(!_items.any((item)=>text(item,'id')==match.itemId))_items.add(match.item);
          final matchingLines=_lines.where((x)=>x.itemId==match.itemId&&x.unitName==match.unit).toList();
          final line=matchingLines.isNotEmpty?matchingLines.first:(_DraftLine()..itemId=match.itemId..unitName=match.unit);
          if(matchingLines.isEmpty)_lines.add(line);
          final count=double.tryParse(line.quantity.text)??0;
          line.quantity.text=(count+1).toString();
          final item=_items.firstWhere((x)=>text(x,'id')==match.itemId);
          final isBatch=flag(item,'requiresBatch');
          final lots=widget.batches.where((b)=>b['warehouseId']==_from&&b['itemId']==match.itemId&&(double.tryParse('${b['remainingQuantity']}')??0)>0).toList();
          if(isBatch&&lots.length==1)line.batchId=text(lots.first,'id');
          _barcode.clear();
        });
      });
    } finally { if(mounted)setState(()=>_scanning=false); }
  }
  void _save(){
    if(_from==null||_to==null||_from==_to||_reason.text.trim().isEmpty)return;
    final lines=<Json>[];
    for(final line in _lines){final q=double.tryParse(line.quantity.text);if(line.itemId==null||q==null||q<=0)return;lines.add({'itemId':line.itemId,'quantity':line.quantity.text,'unitName':line.unitName,'batchId':line.batchId});}
    Navigator.pop(context,{'sourceWarehouseId':_from,'destinationWarehouseId':_to,'transferDate':DateTime.now().toIso8601String().substring(0,10),'reason':_reason.text.trim(),'notes':_notes.text.trim(),'lines':lines});
  }
}

class _TransferDialog extends ConsumerStatefulWidget {const _TransferDialog({required this.id,required this.ar});final String id;final bool ar;@override ConsumerState<_TransferDialog> createState()=>_TransferDialogState();}
class _TransferDialogState extends ConsumerState<_TransferDialog>{
  final _horizontalScroll = ScrollController();
  final _verticalScroll = ScrollController();
  @override void dispose() {
    _horizontalScroll.dispose();
    _verticalScroll.dispose();
    super.dispose();
  }
  Json? row;bool loading=true,busy=false;bool get ar=>widget.ar;String t(String a,String e)=>ar?a:e;@override void initState(){super.initState();_load();}Json? approvalPath;Future<void> _load()async{try{final api=ref.read(apiClientProvider);final x=await api.getObject('/inventory/stock-transfers/${widget.id}');Json? p;try{p=await api.getObject('/inventory/stock-transfers/${widget.id}/approvals');}catch(_){p=null;}if(mounted)setState((){row=x;approvalPath=p;});}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));}finally{if(mounted)setState(()=>loading=false);}}
  @override Widget build(BuildContext context){final user=ref.watch(currentUserProvider);final status=text(row??{},'status');final lines=(row?['lines'] as List? ??const[]).whereType<Map>().map((e)=>Map<String,dynamic>.from(e)).toList();return AlertDialog(title:Text(row==null?t('التحويل','Transfer'):text(row!,'documentNumber')),content:SizedBox(width:800,child:loading?const Center(child:CircularProgressIndicator()):row==null?Text(t('تعذر تحميل التحويل','Could not load transfer')):Column(mainAxisSize:MainAxisSize.min,crossAxisAlignment:CrossAxisAlignment.stretch,children:[Text('${text(row!,'reason')} · $status'),const SizedBox(height:10),_approvalPath(),Flexible(child:Scrollbar(controller:_horizontalScroll,thumbVisibility:true,child:SingleChildScrollView(controller:_horizontalScroll,scrollDirection:Axis.horizontal,child:Scrollbar(controller:_verticalScroll,thumbVisibility:true,child:SingleChildScrollView(controller:_verticalScroll,child:DataTable(columns:[DataColumn(label:Text(t('الصنف','Item'))),DataColumn(label:Text(t('مطلوب','Requested'))),DataColumn(label:Text(t('سُلّم','Dispatched'))),DataColumn(label:Text(t('استُلم','Received'))),DataColumn(label:Text(t('مرتجع','Returned'))),DataColumn(label:Text(t('مفقود/تالف','Short/damaged')))],rows:lines.map((l){final i=l['item'] as Map? ??const{};return DataRow(cells:[DataCell(Text(ar?'${i['nameAr']??i['nameEn']}':'${i['nameEn']??i['nameAr']}')),DataCell(Text('${l['requestedQuantity']}')),DataCell(Text('${l['dispatchedQuantity']}')),DataCell(Text('${l['receivedQuantity']}')),DataCell(Text('${l['returnedQuantity']}')),DataCell(Text('${l['reportedShortage']} / ${l['reportedDamage']}'))]);}).toList()))))))])),actions:_actions(user,status,lines)]);}
  /// The buttons, derived from the document's own state and the caller's
  /// permissions.
  ///
  /// A configured chain is decided level by level, so "Approve" is offered
  /// only when the pending level names a permission this person holds. The
  /// backend enforces the same rules; hiding a button is courtesy, not the
  /// control.
  List<Widget> _actions(Json? user,String status,List<Json> lines){
    final can=(String permission)=>user?.can(permission)??false;
    final configured=approvalPath?['source']=='POLICY';
    final levels=(approvalPath?['levels'] as List? ?? const[]).whereType<Map>().map((e)=>Map<String,dynamic>.from(e)).toList();
    final pending=levels.isEmpty?null:levels.cast<Map<String,dynamic>?>().firstWhere((l)=>l?['state']=='PENDING',orElse:()=>null);
    final mayDecide=pending==null?false:(can('${pending['permission']}')&&(pending['roleCode']==null||(user?.hasRole('${pending['roleCode']}')??false)));
    return [
      if(status=='DRAFT'&&!configured&&can('inventory.transfer.review'))_action('review',t('مراجعة','Review')),
      if(status=='DRAFT'&&can('inventory.transfer.create'))_action('submit',t('إرسال للاعتماد','Submit for approval')),
      if(status=='PENDING_APPROVAL'&&mayDecide)_action('approve',t('اعتماد المستوى','Approve level')),
      if(status=='PENDING_APPROVAL'&&mayDecide)_action('return',t('إرجاع للتعديل','Return for amendment')),
      if(['PENDING_APPROVAL','REVIEWED'].contains(status)&&can('inventory.transfer.review'))_action('reject',t('رفض','Reject')),
      if(status=='REVIEWED'&&can('inventory.transfer.approve'))_action('approve',t('اعتماد','Approve')),
      if(['APPROVED','PARTIALLY_DISPATCHED','PARTIALLY_RECEIVED','DISPATCHING'].contains(status)&&(status!='PARTIALLY_RECEIVED'||lines.any((line)=>(double.tryParse('${line['requestedQuantity']}')??0)>(double.tryParse('${line['dispatchedQuantity']}')??0)))&&can('inventory.transfer.dispatch'))_action('dispatch',t('تسليم','Dispatch')),
      if(['DISPATCHED','PARTIALLY_DISPATCHED','PARTIALLY_RECEIVED','RECEIVING'].contains(status)&&can('inventory.transfer.receive'))_action('receive',t('استلام','Receive')),
      if(['DISPATCHED','PARTIALLY_DISPATCHED','PARTIALLY_RECEIVED','SETTLING'].contains(status)&&can('inventory.transfer.settle'))_action('settle',t('تسوية الفروق','Settle differences')),
      if(status=='SETTLEMENT_PENDING'&&can('inventory.transfer.settle.approve'))_action('settle/approve',t('اعتماد الإعدام','Approve write-off')),
      if(['RECEIVED','SETTLED'].contains(status)&&can('inventory.transfer.close'))_action('close',t('إغلاق','Close')),
      if(!['CLOSED','CANCELLED','REJECTED','SETTLEMENT_PENDING'].contains(status)&&can('inventory.transfer.cancel'))_action('cancel',t('إلغاء/عكس','Cancel/reverse')),
      TextButton(onPressed:busy?null:()=>Navigator.pop(context,true),child:Text(t('تم','Done'))),
    ];
  }

  /// The path this request is following, so a person can see who closed each
  /// level, when, and why — and why an action they expected is not offered.
  Widget _approvalPath(){
    final source=approvalPath?['source'];
    if(source!='POLICY')return const SizedBox.shrink();
    final levels=(approvalPath?['levels'] as List? ?? const[]).whereType<Map>().map((e)=>Map<String,dynamic>.from(e)).toList();
    if(levels.isEmpty)return const SizedBox.shrink();
    return Container(
      margin:const EdgeInsets.only(bottom:10),
      padding:const EdgeInsets.all(8),
      decoration:BoxDecoration(border:Border.all(color:Theme.of(context).dividerColor),borderRadius:BorderRadius.circular(6)),
      child:Column(mainAxisSize:MainAxisSize.min,crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text(t('مسار الاعتماد','Approval path'),style:Theme.of(context).textTheme.labelLarge),
        const SizedBox(height:6),
        ...levels.map((level){
          final state='${level['state']}';
          final label=switch(state){'APPROVED'=>t('معتمد','Approved'),'REJECTED'=>t('مرفوض','Rejected'),'RETURNED'=>t('أُعيد للتعديل','Returned'),'PENDING'=>t('بانتظار القرار','Pending'),_=>t('في الانتظار','Waiting')};
          return Padding(
            padding:const EdgeInsets.symmetric(vertical:2),
            child:Text('${level['level']}. ${ar?level['nameAr']:level['nameEn']} — $label${level['reason']!=null?' · ${level['reason']}':''}',style:Theme.of(context).textTheme.bodySmall),
          );
        }),
      ]),
    );
  }
  Widget _action(String action,String label)=>TextButton(onPressed:busy?null:()=>_run(action),child:Text(label));
  Future<void> _run(String action) async {
    final api = ref.read(apiClientProvider);
    final lines = (row?['lines'] as List? ?? const [])
        .whereType<Map>()
        .map((entry) => Map<String, dynamic>.from(entry))
        .toList();
    Object? body;
    final key = '$action-${DateTime.now().microsecondsSinceEpoch}';
    if (action == 'dispatch' || action == 'receive') {
      final selected = await showDialog<List<Json>>(
        context: context,
        builder: (_) => _QuantityDialog(
          ar: ar,
          lines: lines,
          receive: action == 'receive',
        ),
      );
      if (selected == null || !mounted) return;
      body = {'lines': selected};
    }
    if (action == 'settle') {
      final selected = await showDialog<List<Json>>(
        context: context,
        builder: (_) => _SettlementDialog(ar: ar, lines: lines),
      );
      if (selected == null || !mounted) return;
      body = {'lines': selected};
    }
    if (action == 'reject' || action == 'return') {
      final reason = await _ask(
        action == 'reject'
            ? t('سبب الرفض', 'Rejection reason')
            : t('سبب الإرجاع للتعديل', 'Reason for returning it'),
      );
      if (reason == null || !mounted) return;
      body = {'reason': reason};
    }
    if (!mounted) return;
    setState(() => busy = true);
    try {
      await api.post(
        '/inventory/stock-transfers/${widget.id}/$action',
        body: body,
        idempotencyKey: key,
      );
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
  Future<String?> _ask(String title) async {
    final controller = TextEditingController();
    final route = DialogRoute<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(controller: controller),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(t('إلغاء', 'Cancel'))),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text), child: Text(t('تأكيد', 'Confirm'))),
        ],
      ),
    );
    final value = await Navigator.of(context, rootNavigator: true).push(route);
    await route.completed;
    controller.dispose();
    return value;
  }
}

class _QuantityDialog extends StatefulWidget {
  const _QuantityDialog({
    required this.ar,
    required this.lines,
    required this.receive,
  });

  final bool ar;
  final bool receive;
  final List<Json> lines;

  @override
  State<_QuantityDialog> createState() => _QuantityDialogState();
}

class _QuantityDialogState extends State<_QuantityDialog> {
  late final List<TextEditingController> controllers;

  @override
  void initState() {
    super.initState();
    controllers = widget.lines.map((line) {
      final dispatched = double.tryParse('${line['dispatchedQuantity']}') ?? 0;
      final received = double.tryParse('${line['receivedQuantity']}') ?? 0;
      final requested = double.tryParse('${line['requestedQuantity']}') ?? 0;
      final returned = double.tryParse('${line['returnedQuantity']}') ?? 0;
      final writtenOff = double.tryParse('${line['writtenOffQuantity']}') ?? 0;
      final remaining = widget.receive
          ? dispatched - received - returned - writtenOff
          : requested - dispatched;
      return TextEditingController(text: remaining.clamp(0, double.infinity).toString());
    }).toList();
  }

  @override
  void dispose() {
    for (final controller in controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.ar
            ? (widget.receive ? 'تسجيل الاستلام' : 'تسجيل التسليم')
            : (widget.receive ? 'Receive quantities' : 'Dispatch quantities')),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: List.generate(widget.lines.length, (index) {
                final item = widget.lines[index]['item'] as Map? ?? const {};
                final itemName = widget.ar
                    ? (item['nameAr'] ?? item['nameEn'])
                    : (item['nameEn'] ?? item['nameAr']);
                return Row(
                  children: [
                    Expanded(child: Text('$itemName')),
                    SizedBox(
                      width: 110,
                      child: TextField(
                        controller: controllers[index],
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: InputDecoration(labelText: widget.ar ? 'كمية' : 'Qty'),
                      ),
                    ),
                  ],
                );
              }),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(widget.ar ? 'إلغاء' : 'Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final result = <Json>[];
              for (var index = 0; index < widget.lines.length; index++) {
                final quantity = double.tryParse(controllers[index].text) ?? 0;
                if (quantity > 0) {
                  result.add({
                    'lineId': widget.lines[index]['id'],
                    'quantity': controllers[index].text,
                  });
                }
              }
              Navigator.pop(context, result);
            },
            child: Text(widget.ar ? 'تأكيد' : 'Confirm'),
          ),
        ],
      );
}

class _SettlementDialog extends StatefulWidget {
  const _SettlementDialog({required this.ar, required this.lines});
  final bool ar;
  final List<Json> lines;

  @override
  State<_SettlementDialog> createState() => _SettlementDialogState();
}

class _SettlementDialogState extends State<_SettlementDialog> {
  late final List<TextEditingController> returns;
  late final List<TextEditingController> shortages;
  late final List<TextEditingController> damages;
  late final List<TextEditingController> reasons;

  String t(String arabic, String english) => widget.ar ? arabic : english;

  @override
  void initState() {
    super.initState();
    returns = List.generate(widget.lines.length, (_) => TextEditingController(text: '0'));
    shortages = List.generate(widget.lines.length, (_) => TextEditingController(text: '0'));
    damages = List.generate(widget.lines.length, (_) => TextEditingController(text: '0'));
    reasons = List.generate(widget.lines.length, (_) => TextEditingController());
  }

  @override
  void dispose() {
    for (final group in [returns, shortages, damages, reasons]) {
      for (final controller in group) {
        controller.dispose();
      }
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(t('تسوية البضاعة بالطريق', 'Settle goods in transit')),
        content: SizedBox(
          width: 780,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SingleChildScrollView(
              child: DataTable(
                columns: [
                  DataColumn(label: Text(t('الصنف', 'Item'))),
                  DataColumn(label: Text(t('مرتجع', 'Return'))),
                  DataColumn(label: Text(t('مفقود', 'Shortage'))),
                  DataColumn(label: Text(t('تالف', 'Damaged'))),
                  DataColumn(label: Text(t('السبب', 'Reason'))),
                ],
                rows: List.generate(widget.lines.length, (index) {
                  final item = widget.lines[index]['item'] as Map? ?? const {};
                  final name = widget.ar
                      ? (item['nameAr'] ?? item['nameEn'])
                      : (item['nameEn'] ?? item['nameAr']);
                  return DataRow(cells: [
                    DataCell(SizedBox(width: 140, child: Text('$name'))),
                    DataCell(_field(returns[index])),
                    DataCell(_field(shortages[index])),
                    DataCell(_field(damages[index])),
                    DataCell(SizedBox(
                      width: 190,
                      child: TextField(
                        controller: reasons[index],
                        decoration: InputDecoration(
                          hintText: t('سبب الفقد أو التلف', 'Reason for loss/damage'),
                        ),
                      ),
                    )),
                  ]);
                }),
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(t('إلغاء', 'Cancel')),
          ),
          FilledButton(
            onPressed: () {
              final result = <Json>[];
              for (var index = 0; index < widget.lines.length; index++) {
                final returned = double.tryParse(returns[index].text) ?? 0;
                final shortage = double.tryParse(shortages[index].text) ?? 0;
                final damage = double.tryParse(damages[index].text) ?? 0;
                if (returned > 0 || shortage > 0 || damage > 0) {
                  result.add({
                    'lineId': widget.lines[index]['id'],
                    'returnedQuantity': returns[index].text,
                    'shortage': shortages[index].text,
                    'damage': damages[index].text,
                    'reason': reasons[index].text,
                  });
                }
              }
              if (result.isNotEmpty) Navigator.pop(context, result);
            },
            child: Text(t('إرسال التسوية', 'Submit settlement')),
          ),
        ],
      );

  Widget _field(TextEditingController controller) => SizedBox(
        width: 85,
        child: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(isDense: true),
        ),
      );
}
