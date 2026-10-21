from pathlib import Path


def rep(path, old, new, count=1):
    p=Path(path); s=p.read_text()
    if s.count(old)<count: raise RuntimeError(f'missing pattern {path}: {old[:80]!r}')
    p.write_text(s.replace(old,new,count))

# Rich per-element design model.
p='lib/features/quotations/presentation/document/quotation_document.dart'
rep(p, """    this.fontSizeMultiplier = 1.0,\n    this.fontWeight,\n    this.color,\n  });""", """    this.fontSizeMultiplier = 1.0,\n    this.fontWeight,\n    this.color,\n    this.fontFamily,\n    this.textAlign,\n    this.lineHeight,\n    this.backgroundColor,\n    this.borderColor,\n    this.borderWidth,\n  });""")
rep(p, """  final String? color;\n\n  /// ينشئ نسخة من هذا النمط مع تعديلات جزئية.""", """  final String? color;\n  final String? fontFamily;\n  final TextAlign? textAlign;\n  final double? lineHeight;\n  final String? backgroundColor;\n  final String? borderColor;\n  final double? borderWidth;\n\n  /// ينشئ نسخة من هذا النمط مع تعديلات جزئية.""")
rep(p, """    double? fontSizeMultiplier,\n    FontWeight? fontWeight,\n    String? color,\n  }) {""", """    double? fontSizeMultiplier,\n    FontWeight? fontWeight,\n    String? color,\n    String? fontFamily,\n    TextAlign? textAlign,\n    double? lineHeight,\n    String? backgroundColor,\n    String? borderColor,\n    double? borderWidth,\n  }) {""")
rep(p, """      fontWeight: fontWeight ?? this.fontWeight,\n      color: color ?? this.color,\n    );""", """      fontWeight: fontWeight ?? this.fontWeight,\n      color: color ?? this.color,\n      fontFamily: fontFamily ?? this.fontFamily,\n      textAlign: textAlign ?? this.textAlign,\n      lineHeight: lineHeight ?? this.lineHeight,\n      backgroundColor: backgroundColor ?? this.backgroundColor,\n      borderColor: borderColor ?? this.borderColor,\n      borderWidth: borderWidth ?? this.borderWidth,\n    );""")
rep(p, """        fontWeight: _fontWeightOf(v['fontWeight']),\n        color: v['color'] as String?,\n      );""", """        fontWeight: _fontWeightOf(v['fontWeight']),\n        color: v['color'] as String?,\n        fontFamily: v['fontFamily'] as String?,\n        textAlign: _textAlignOf(v['textAlign']),\n        lineHeight: (v['lineHeight'] as num?)?.toDouble(),\n        backgroundColor: v['backgroundColor'] as String?,\n        borderColor: v['borderColor'] as String?,\n        borderWidth: (v['borderWidth'] as num?)?.toDouble(),\n      );""")
rep(p, """        if (s.fontWeight != null) 'fontWeight': s.fontWeight.toString(),\n        if (s.color != null) 'color': s.color,\n      };""", """        if (s.fontWeight != null) 'fontWeight': s.fontWeight.toString(),\n        if (s.color != null) 'color': s.color,\n        if (s.fontFamily?.trim().isNotEmpty == true) 'fontFamily': s.fontFamily,\n        if (s.textAlign != null) 'textAlign': s.textAlign.toString().split('.').last,\n        if (s.lineHeight != null) 'lineHeight': s.lineHeight,\n        if (s.backgroundColor != null) 'backgroundColor': s.backgroundColor,\n        if (s.borderColor != null) 'borderColor': s.borderColor,\n        if (s.borderWidth != null) 'borderWidth': s.borderWidth,\n      };""")
rep(p, """FontWeight? _fontWeightOf(dynamic v) {""", """TextAlign? _textAlignOf(dynamic v) {\n  if (v is! String) return null;\n  return switch (v) {\n    'start' => TextAlign.start, 'end' => TextAlign.end, 'left' => TextAlign.left,\n    'right' => TextAlign.right, 'center' => TextAlign.center, 'justify' => TextAlign.justify, _ => null,\n  };\n}\n\nFontWeight? _fontWeightOf(dynamic v) {""")

# Preview honors family and line-height for every style that already participates in the renderer.
p='lib/features/quotations/presentation/widgets/quotation_document_view.dart'
rep(p, """      fontWeight: style.fontWeight ?? base.fontWeight,\n      color: style.color != null\n          ? _parseColor(style.color!)\n          : base.color,\n    );""", """      fontWeight: style.fontWeight ?? base.fontWeight,\n      color: style.color != null ? _parseColor(style.color!) : base.color,\n      fontFamily: style.fontFamily?.trim().isNotEmpty == true ? style.fontFamily : base.fontFamily,\n      height: style.lineHeight ?? base.height,\n    );""")

# Add a compact design editor to the existing quotation editor and persist it through its existing design JSON.
p='lib/features/quotations/presentation/screens/quotation_editor_screen.dart'
marker='  /// The line columns this offer prints, and the button that changes them.\n  Widget _columnsCard(BuildContext context) {'
method=r'''  Future<void> _editDesign() async {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    const keys = ['title','company','customer','sectionTitle','tableHeader','tableCell','totalsLabel','totalsValue','finalTotal','header','footer'];
    final labels = {for (final k in keys) k: k == 'title' ? (ar?'العنوان':'Title') : k == 'company' ? (ar?'اسم الشركة':'Company') : k == 'customer' ? (ar?'العميل':'Customer') : k == 'sectionTitle' ? (ar?'عنوان الجدول':'Table title') : k == 'tableHeader' ? (ar?'رأس الجدول':'Table header') : k == 'tableCell' ? (ar?'خلايا الجدول':'Table cells') : k == 'totalsLabel' ? (ar?'تسميات الإجماليات':'Totals labels') : k == 'totalsValue' ? (ar?'قيم الإجماليات':'Totals values') : k == 'finalTotal' ? (ar?'الإجمالي النهائي':'Final total') : k == 'header' ? (ar?'الهيدر':'Header') : (ar?'الفوتر':'Footer')};
    QuotationDocumentElementStyle? get(String k) => switch(k) { 'title'=>_design.title,'company'=>_design.company,'customer'=>_design.customer,'sectionTitle'=>_design.sectionTitle,'tableHeader'=>_design.tableHeader,'tableCell'=>_design.tableCell,'totalsLabel'=>_design.totalsLabel,'totalsValue'=>_design.totalsValue,'finalTotal'=>_design.finalTotal,'header'=>_design.header,'footer'=>_design.footer,_=>null };
    final styles={for(final k in keys) k:get(k)??const QuotationDocumentElementStyle()};
    String selected='title';
    final ok=await showDialog<bool>(context:context,builder:(dc)=>StatefulBuilder(builder:(dc,set)=>AlertDialog(
      title:Text(ar?'تنسيق عرض السعر':'Quotation design'),
      content:SizedBox(width:760,height:430,child:ListView(children:[
        DropdownButtonFormField<String>(initialValue:selected,decoration:InputDecoration(labelText:ar?'العنصر':'Element'),items:[for(final k in keys) DropdownMenuItem(value:k,child:Text(labels[k]!))],onChanged:(v){if(v!=null)set(()=>selected=v);}),
        const SizedBox(height:12),
        Builder(builder:(_){final s=styles[selected]!;final size=TextEditingController(text:s.fontSizeMultiplier.toStringAsFixed(2));final line=TextEditingController(text:(s.lineHeight??1.4).toStringAsFixed(2));final color=TextEditingController(text:s.color??'#1E60AA');final bg=TextEditingController(text:s.backgroundColor??'');final bc=TextEditingController(text:s.borderColor??'');final bw=TextEditingController(text:(s.borderWidth??0).toStringAsFixed(1));void upd(QuotationDocumentElementStyle x)=>set(()=>styles[selected]=x);return Wrap(spacing:10,runSpacing:10,children:[
          SizedBox(width:160,child:TextField(controller:size,keyboardType:const TextInputType.numberWithOptions(decimal:true),decoration:InputDecoration(labelText:ar?'حجم الخط ×':'Font size ×'),onChanged:(v){final n=double.tryParse(v);if(n!=null)upd(s.copyWith(fontSizeMultiplier:n.clamp(.65,2.5)));})),
          SizedBox(width:180,child:DropdownButtonFormField<String>(initialValue:s.fontFamily??'Tahoma',decoration:InputDecoration(labelText:ar?'نوع الخط':'Font family'),items:const ['Tahoma','Segoe UI','Arial','Noto Naskh Arabic','Noto Sans Arabic','Cairo','Amiri'].map((f)=>DropdownMenuItem(value:f,child:Text(f))).toList(),onChanged:(v){if(v!=null)upd(s.copyWith(fontFamily:v));})),
          SizedBox(width:160,child:DropdownButtonFormField<FontWeight>(initialValue:s.fontWeight??FontWeight.w400,decoration:InputDecoration(labelText:ar?'السمك':'Weight'),items:const [FontWeight.w300,FontWeight.w400,FontWeight.w500,FontWeight.w600,FontWeight.w700,FontWeight.w800].map((w)=>DropdownMenuItem(value:w,child:Text(w==FontWeight.w700?'Bold':w==FontWeight.w600?'Semi bold':w==FontWeight.w500?'Medium':w==FontWeight.w800?'Extra bold':w==FontWeight.w300?'Light':'Regular'))).toList(),onChanged:(v){if(v!=null)upd(s.copyWith(fontWeight:v));})),
          SizedBox(width:160,child:DropdownButtonFormField<TextAlign>(initialValue:s.textAlign??TextAlign.start,decoration:InputDecoration(labelText:ar?'المحاذاة':'Alignment'),items:const [TextAlign.start,TextAlign.center,TextAlign.end,TextAlign.justify].map((a)=>DropdownMenuItem(value:a,child:Text(a==TextAlign.center?'Center':a==TextAlign.end?'End':a==TextAlign.justify?'Justify':'Start'))).toList(),onChanged:(v){if(v!=null)upd(s.copyWith(textAlign:v));})),
          SizedBox(width:160,child:TextField(controller:line,keyboardType:const TextInputType.numberWithOptions(decimal:true),decoration:InputDecoration(labelText:ar?'ارتفاع السطر':'Line height'),onChanged:(v){final n=double.tryParse(v);if(n!=null)upd(s.copyWith(lineHeight:n.clamp(.8,3)));})),
          SizedBox(width:160,child:TextField(controller:color,decoration:InputDecoration(labelText:ar?'لون النص':'Text color'),onChanged:(v)=>upd(s.copyWith(color:v.trim())))),
          SizedBox(width:160,child:TextField(controller:bg,decoration:InputDecoration(labelText:ar?'الخلفية':'Background'),onChanged:(v)=>upd(s.copyWith(backgroundColor:v.trim().isEmpty?null:v.trim())))),
          SizedBox(width:160,child:TextField(controller:bc,decoration:InputDecoration(labelText:ar?'لون الحدود':'Border color'),onChanged:(v)=>upd(s.copyWith(borderColor:v.trim().isEmpty?null:v.trim())))),
          SizedBox(width:160,child:TextField(controller:bw,keyboardType:const TextInputType.numberWithOptions(decimal:true),decoration:InputDecoration(labelText:ar?'سمك الحدود':'Border width'),onChanged:(v){final n=double.tryParse(v);if(n!=null)upd(s.copyWith(borderWidth:n.clamp(0,6)));})),
        ]);}),
        const SizedBox(height:14),Text(ar?'يتم حفظ التنسيق داخل العرض ويستخدم في المعاينة وPDF والطباعة.':'Design is stored with the quotation and used by preview, PDF and print.',style:Theme.of(context).textTheme.bodySmall),
      ])),
      actions:[TextButton(onPressed:()=>Navigator.pop(dc,false),child:Text(ar?'إلغاء':'Cancel')),FilledButton(onPressed:()=>Navigator.pop(dc,true),child:Text(ar?'حفظ التصميم':'Save design'))],
    )));
    if(ok!=true||!mounted)return;
    QuotationDocumentElementStyle? g(String k)=>styles[k];
    setState(()=>_design=QuotationDocumentDesign(title:g('title'),company:g('company'),customer:g('customer'),sectionTitle:g('sectionTitle'),tableHeader:g('tableHeader'),tableCell:g('tableCell'),totalsLabel:g('totalsLabel'),totalsValue:g('totalsValue'),finalTotal:g('finalTotal'),header:g('header'),footer:g('footer')));
  }

'''
rep(p,marker,method+marker)
rep(p,"""    final language = Localizations.localeOf(context).languageCode;\n    // Inactive records are included""","""    final language = Localizations.localeOf(context).languageCode;\n    final arabic = language == 'ar';\n    // Inactive records are included""")
rep(p,"""                _columnsCard(context),\n                const SizedBox(height: 12),""","""                Card(child:Padding(padding:const EdgeInsets.all(12),child:Row(children:[const Icon(Icons.design_services_outlined),const SizedBox(width:8),Expanded(child:Text(arabic?'تصميم عرض السعر':'Quotation design',style:Theme.of(context).textTheme.titleSmall)),OutlinedButton.icon(onPressed:_editDesign,icon:const Icon(Icons.tune,size:18),label:Text(arabic?'تخصيص كل عنصر':'Customize each element'))]))),\n                const SizedBox(height: 12),\n                _columnsCard(context),\n                const SizedBox(height: 12),""")

# Backend PDF/print: apply persisted design safely through CSS hooks.
p='backend/src/modules/sales/quotation-document.ts'
needle="""function quantity(value: string): string {\n  return Number(value).toLocaleString('en-US', {\n    maximumFractionDigits: 4,\n  });\n}\n"""
helper="""function quantity(value: string): string {\n  return Number(value).toLocaleString('en-US', {\n    maximumFractionDigits: 4,\n  });\n}\n\nfunction designCss(content: QuotationSnapshot): string {\n  const d=content.design; if(!d || typeof d!=='object') return '';\n  const color=(v:unknown)=>typeof v==='string' && /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(v.trim()) ? v.trim() : null;\n  const family=(v:unknown)=>['Tahoma','Segoe UI','Arial','Noto Naskh Arabic','Noto Sans Arabic','Cairo','Amiri'].includes(String(v)) ? String(v) : null;\n  const num=(v:unknown,min:number,max:number)=>{const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?String(Math.round(n*100)/100):null;};\n  const align=(v:unknown)=>['start','end','left','right','center','justify'].includes(String(v))?String(v):null;\n  const out:string[]=[];\n  for(const [k,r] of Object.entries(d as Record<string,unknown>)){if(!r||typeof r!=='object')continue;const x=r as Record<string,unknown>;const a:string[]=[];const f=family(x.fontFamily),c=color(x.color),bg=color(x.backgroundColor),bc=color(x.borderColor),bw=num(x.borderWidth,0,6),lh=num(x.lineHeight,.8,3),al=align(x.textAlign);if(f)a.push(`font-family:${f},Tahoma,'Segoe UI',Arial,sans-serif`);if(c)a.push(`color:${c}`);if(bg)a.push(`background:${bg}`);if(bc&&bw)a.push(`border-color:${bc};border-width:${bw}pt`);if(lh)a.push(`line-height:${lh}`);if(al)a.push(`text-align:${al}`);if(a.length)out.push(`.design-${k}{${a.join(';')}}`)}\n  return out.join('\\n');\n}\n"""
rep(p,needle,helper)
rep(p,"""  @media print {\n""","""  ${designCss(content)}\n  @media print {\n""")
rep(p,'`<h1>${escapeHtml(companyName)}</h1>`','`<h1 class="design-company">${escapeHtml(companyName)}</h1>`')
rep(p,'`<h2>${L(\'QUOTATION\', \'عرض سعر\')}</h2>`','`<h2 class="design-title">${L(\'QUOTATION\', \'عرض سعر\')}</h2>`')
rep(p,'`<h3>${escapeHtml(customerName)}</h3>`','`<h3 class="design-customer">${escapeHtml(customerName)}</h3>`')
rep(p,'`<h3>${escapeHtml(table.title)}</h3>`','`<h3 class="design-sectionTitle">${escapeHtml(table.title)}</h3>`')

print('quotation design finalization applied')
