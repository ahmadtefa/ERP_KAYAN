import 'dart:io';
import 'dart:ui' as ui;
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/features/dashboard/presentation/widgets/dashboard_panels.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('synthetic shared navy palette chart table and form preview', (tester) async {
    tester.view.physicalSize=const Size(1280,900);tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    await tester.runAsync(() async {
      for(final name in ['IBMPlexSansArabic']) {
        final loader=FontLoader(name);loader.addFont(Future.value(ByteData.sublistView(File('assets/fonts/$name-Regular.ttf').readAsBytesSync())));await loader.load();
      }
    });
    final key=GlobalKey();final months=[for(var i=1;i<=12;i++) <String,dynamic>{'month':'2026-${i.toString().padLeft(2,'0')}','sales':100000+i*35000,'purchases':80000+i*15000,'result':i==2 ? -30000:20000+i*5000}];
    await tester.pumpWidget(RepaintBoundary(key:key,child:MaterialApp(debugShowCheckedModeBanner:false,theme:Platform.environment['KAYAN_LIGHT_PREVIEW']=='1'?AppTheme.light():AppTheme.dark(),locale:const Locale('ar'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,home:Scaffold(appBar:AppBar(title:const Text('كيان | مثال توضيحي ببيانات تجريبية')),body:Padding(padding:const EdgeInsets.all(24),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
      Card(child:Padding(padding:const EdgeInsets.all(20),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('المؤشرات شهريًا',style:TextStyle(fontSize:20,fontWeight:FontWeight.bold)),const SizedBox(height:12),MonthlyBarsChart(months:months,arabic:true)]))),
      const SizedBox(height:16),Expanded(child:Row(crossAxisAlignment:CrossAxisAlignment.stretch,children:[Expanded(child:Card(child:Padding(padding:const EdgeInsets.all(20),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[const Text('فواتير البيع | بيانات تجريبية',style:TextStyle(fontSize:18,fontWeight:FontWeight.bold)),DataTable(columns:const [DataColumn(label:Text('الفاتورة')),DataColumn(label:Text('العميل')),DataColumn(label:Text('الإجمالي')),DataColumn(label:Text('الحالة'))],rows:[for(var i=1;i<=4;i++) DataRow(cells:[DataCell(Text('SYN-00$i')),DataCell(Text('عميل تجريبي $i')),DataCell(Text('${i*1250}.00')),const DataCell(Text('مسودة'))])])])))),const SizedBox(width:16),Expanded(child:Card(child:Padding(padding:const EdgeInsets.all(20),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[const Text('بيانات الفاتورة',style:TextStyle(fontSize:18,fontWeight:FontWeight.bold)),const SizedBox(height:20),const TextField(decoration:InputDecoration(labelText:'العميل',hintText:'اختر عميلًا')),const SizedBox(height:16),const TextField(decoration:InputDecoration(labelText:'ملاحظات',hintText:'أضف ملاحظة')),const SizedBox(height:18),FilledButton(onPressed:(){},child:const Text('حفظ المسودة')),const SizedBox(height:12),const Text('المثال لا يحتوي على بيانات الشركة الفعلية')]))))])),
    ]))))));
    await tester.pumpAndSettle();expect(tester.takeException(),isNull);
    if(Platform.environment['KAYAN_TOOLTIP_PREVIEW']=='1') { await tester.tap(find.byType(Tooltip).first);await tester.pumpAndSettle(); }
    final output=Platform.environment['KAYAN_PALETTE_SHOT'];
    if(output!=null) {await tester.runAsync(() async {final boundary=key.currentContext!.findRenderObject()! as RenderRepaintBoundary;final image=await boundary.toImage();final bytes=await image.toByteData(format:ui.ImageByteFormat.png);File(output).writeAsBytesSync(bytes!.buffer.asUint8List());});}
  });
}
