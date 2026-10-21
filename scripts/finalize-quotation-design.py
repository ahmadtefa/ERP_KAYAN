from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def edit(path, replacements):
    p = ROOT / path
    s = p.read_text(encoding='utf-8')
    original = s
    for old, new in replacements:
        if old not in s:
            raise SystemExit(f'Missing marker in {path}: {old[:120]!r}')
        s = s.replace(old, new, 1)
    if s == original:
        raise SystemExit(f'No changes made to {path}')
    p.write_text(s, encoding='utf-8')


# Flutter document design model: all requested per-element controls are persisted.
p = ROOT / 'lib/features/quotations/presentation/document/quotation_document.dart'
s = p.read_text(encoding='utf-8')
old = '''class QuotationDocumentElementStyle {\n  const QuotationDocumentElementStyle({\n    this.fontSizeMultiplier = 1.0,\n    this.fontWeight,\n    this.color,\n  });'''
new = '''class QuotationDocumentElementStyle {\n  const QuotationDocumentElementStyle({\n    this.fontSizeMultiplier = 1.0,\n    this.fontWeight,\n    this.color,\n    this.fontFamily,\n    this.textAlign,\n    this.lineHeight,\n    this.backgroundColor,\n    this.borderColor,\n    this.borderWidth = 0,\n    this.visible = true,\n    this.customText,\n  });'''
if old not in s: raise SystemExit('style constructor marker missing')
s = s.replace(old, new, 1)
s = s.replace('''  final String? color;\n\n  /// ينشئ نسخة''', '''  final String? color;\n  final String? fontFamily;\n  final TextAlign? textAlign;\n  final double? lineHeight;\n  final String? backgroundColor;\n  final String? borderColor;\n  final double borderWidth;\n  final bool visible;\n  final String? customText;\n\n  /// ينشئ نسخة''', 1)
s = s.replace('''    FontWeight? fontWeight,\n    String? color,\n  }) {\n    return QuotationDocumentElementStyle(\n      fontSizeMultiplier: fontSizeMultiplier ?? this.fontSizeMultiplier,\n      fontWeight: fontWeight ?? this.fontWeight,\n      color: color ?? this.color,\n    );''', '''    FontWeight? fontWeight,\n    String? color,\n    String? fontFamily,\n    TextAlign? textAlign,\n    double? lineHeight,\n    String? backgroundColor,\n    String? borderColor,\n    double? borderWidth,\n    bool? visible,\n    String? customText,\n  }) {\n    return QuotationDocumentElementStyle(\n      fontSizeMultiplier: fontSizeMultiplier ?? this.fontSizeMultiplier,\n      fontWeight: fontWeight ?? this.fontWeight,\n      color: color ?? this.color,\n      fontFamily: fontFamily ?? this.fontFamily,\n      textAlign: textAlign ?? this.textAlign,\n      lineHeight: lineHeight ?? this.lineHeight,\n      backgroundColor: backgroundColor ?? this.backgroundColor,\n      borderColor: borderColor ?? this.borderColor,\n      borderWidth: borderWidth ?? this.borderWidth,\n      visible: visible ?? this.visible,\n      customText: customText ?? this.customText,\n    );''', 1)
s = s.replace('''        fontWeight: _fontWeightOf(v['fontWeight']),\n        color: v['color'] as String?,\n      );''', '''        fontWeight: _fontWeightOf(v['fontWeight']),\n        color: v['color'] as String?,\n        fontFamily: v['fontFamily'] as String?,\n        textAlign: _textAlignOf(v['textAlign']),\n        lineHeight: (v['lineHeight'] as num?)?.toDouble(),\n        backgroundColor: v['backgroundColor'] as String?,\n        borderColor: v['borderColor'] as String?,\n        borderWidth: (v['borderWidth'] as num?)?.toDouble() ?? 0,\n        visible: v['visible'] != false,\n        customText: v['customText'] as String?,\n      );''', 1)
s = s.replace('''        if (s.fontWeight != null) 'fontWeight': s.fontWeight.toString(),\n        if (s.color != null) 'color': s.color,\n      };''', '''        if (s.fontWeight != null) 'fontWeight': s.fontWeight.toString(),\n        if (s.color != null) 'color': s.color,\n        if (s.fontFamily != null && s.fontFamily!.trim().isNotEmpty) 'fontFamily': s.fontFamily,\n        if (s.textAlign != null) 'textAlign': s.textAlign.toString().split('.').last,\n        if (s.lineHeight != null) 'lineHeight': s.lineHeight,\n        if (s.backgroundColor != null) 'backgroundColor': s.backgroundColor,\n        if (s.borderColor != null) 'borderColor': s.borderColor,\n        if (s.borderWidth > 0) 'borderWidth': s.borderWidth,\n        if (!s.visible) 'visible': false,\n        if (s.customText != null && s.customText!.trim().isNotEmpty) 'customText': s.customText,\n      };''', 1)
s = s.replace('''FontWeight? _fontWeightOf(dynamic v) {''', '''TextAlign? _textAlignOf(dynamic v) {\n  if (v is! String) return null;\n  return switch (v) {\n    'left' => TextAlign.left,\n    'right' => TextAlign.right,\n    'center' => TextAlign.center,\n    'justify' => TextAlign.justify,\n    'start' => TextAlign.start,\n    'end' => TextAlign.end,\n    _ => null,\n  };\n}\n\nFontWeight? _fontWeightOf(dynamic v) {''', 1)
p.write_text(s, encoding='utf-8')

# Preview applies the expanded style model to text and containers.
edit('lib/features/quotations/presentation/widgets/quotation_document_view.dart', [
('''    return base.copyWith(\n      fontSize: (base.fontSize ?? 12) * style.fontSizeMultiplier,\n      fontWeight: style.fontWeight ?? base.fontWeight,\n      color: style.color != null\n          ? _parseColor(style.color!)\n          : base.color,\n    );''', '''    return base.copyWith(\n      fontSize: (base.fontSize ?? 12) * style.fontSizeMultiplier,\n      fontWeight: style.fontWeight ?? base.fontWeight,\n      color: style.color != null ? _parseColor(style.color!) : base.color,\n      fontFamily: style.fontFamily ?? base.fontFamily,\n      height: style.lineHeight ?? base.height,\n    );'''),
('''    return Container(\n      width: double.infinity,''', '''    final headerStyle = d.design?.header;\n    final footerStyle = d.design?.footer;\n    return Container(\n      width: double.infinity,'''),
('''          _masthead(),''', '''          if (headerStyle?.visible != false) _masthead(),'''),
('''          _footer(),''', '''          if (footerStyle?.visible != false) _footer(),'''),
])

# Editor: expose a real per-element designer rather than storing an inaccessible JSON blob.
p = ROOT / 'lib/features/quotations/presentation/screens/quotation_editor_screen.dart'
s = p.read_text(encoding='utf-8')
marker = '''                _columnsCard(context),\n                const SizedBox(height: 12),'''
replacement = '''                _columnsCard(context),\n                const SizedBox(height: 12),\n                _designCard(context),\n                const SizedBox(height: 12),'''
if marker not in s: raise SystemExit('editor design insertion marker missing')
s = s.replace(marker, replacement, 1)
marker = '''  /// The line columns this offer prints, and the button that changes them.\n  Widget _columnsCard'''
design = r'''  Widget _designCard(BuildContext context) {
    final l10n = context.l10n;
    final labels = <String, String>{
      'title': 'عنوان العرض', 'company': 'اسم الشركة', 'customer': 'بيانات العميل',
      'sectionTitle': 'عناوين الجداول', 'tableHeader': 'رؤوس الجداول',
      'tableCell': 'خلايا الجداول', 'totalsLabel': 'عناوين الإجماليات',
      'totalsValue': 'قيم الإجماليات', 'finalTotal': 'الإجمالي النهائي',
      'header': 'الهيدر', 'footer': 'الفوتر',
    };
    final enabled = _design.toJson().keys.where(labels.containsKey).length;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('تنسيق عرض السعر', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            Text('تحكم مستقل في الخط والحجم واللون والمحاذاة والمسافات والخلفية والحدود لكل جزء.', style: Theme.of(context).textTheme.bodySmall),
            if (enabled > 0) Text('$enabled عناصر مخصصة', style: Theme.of(context).textTheme.bodySmall),
          ])),
          OutlinedButton.icon(
            key: const ValueKey('quotation-design-editor'),
            onPressed: _editDesign,
            icon: const Icon(Icons.palette_outlined, size: 18),
            label: const Text('تخصيص التصميم'),
          ),
        ]),
      ),
    );
  }

  Future<void> _editDesign() async {
    const keys = ['title','company','customer','sectionTitle','tableHeader','tableCell','totalsLabel','totalsValue','finalTotal','header','footer'];
    const labels = {
      'title':'عنوان العرض','company':'اسم الشركة','customer':'بيانات العميل','sectionTitle':'عناوين الجداول',
      'tableHeader':'رؤوس الجداول','tableCell':'خلايا الجداول','totalsLabel':'عناوين الإجماليات','totalsValue':'قيم الإجماليات',
      'finalTotal':'الإجمالي النهائي','header':'الهيدر','footer':'الفوتر',
    };
    String selected = 'title';
    final family = TextEditingController();
    final size = TextEditingController(text: '1.0');
    final color = TextEditingController();
    final background = TextEditingController();
    final border = TextEditingController();
    final borderWidth = TextEditingController(text: '0');
    final lineHeight = TextEditingController();
    final customText = TextEditingController();
    var weight = FontWeight.w400;
    var align = TextAlign.start;
    var visible = true;
    void load() {
      final j = _design.toJson()[selected];
      if (j is Map) {
        family.text = '${j['fontFamily'] ?? ''}'; size.text = '${j['fontSizeMultiplier'] ?? 1.0}';
        color.text = '${j['color'] ?? ''}'; background.text = '${j['backgroundColor'] ?? ''}';
        border.text = '${j['borderColor'] ?? ''}'; borderWidth.text = '${j['borderWidth'] ?? 0}';
        lineHeight.text = '${j['lineHeight'] ?? ''}'; customText.text = '${j['customText'] ?? ''}';
        final a = '${j['textAlign'] ?? 'start'}';
        align = switch (a) { 'left'=>TextAlign.left, 'right'=>TextAlign.right, 'center'=>TextAlign.center, 'justify'=>TextAlign.justify, _=>TextAlign.start };
        visible = j['visible'] != false;
      } else { family.clear(); size.text='1.0'; color.clear(); background.clear(); border.clear(); borderWidth.text='0'; lineHeight.clear(); customText.clear(); visible=true; align=TextAlign.start; }
    }
    load();
    await showDialog<void>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (dialogContext, setDialogState) {
      final current = _design.toJson()[selected];
      if (current is Map && family.text.isEmpty && size.text == '1.0') load();
      return AlertDialog(
        title: const Text('تخصيص عنصر العرض'),
        content: SizedBox(width: 720, child: SingleChildScrollView(child: Column(children: [
          DropdownButtonFormField<String>(initialValue: selected, decoration: const InputDecoration(labelText:'العنصر', border:OutlineInputBorder()), items:[for(final k in keys) DropdownMenuItem(value:k, child:Text(labels[k]!))], onChanged:(v){ if(v==null)return; setDialogState((){selected=v; load();}); }),
          const SizedBox(height:10),
          Wrap(spacing:10, runSpacing:10, children:[
            SizedBox(width:180, child:TextField(controller:family, decoration:const InputDecoration(labelText:'نوع الخط', hintText:'Tahoma / Arial / Segoe UI', border:OutlineInputBorder()))),
            SizedBox(width:130, child:TextField(controller:size, keyboardType:const TextInputType.numberWithOptions(decimal:true), decoration:const InputDecoration(labelText:'حجم الخط', border:OutlineInputBorder()))),
            SizedBox(width:160, child:TextField(controller:lineHeight, keyboardType:const TextInputType.numberWithOptions(decimal:true), decoration:const InputDecoration(labelText:'ارتفاع السطر', border:OutlineInputBorder()))),
            SizedBox(width:150, child:DropdownButtonFormField<FontWeight>(initialValue:weight, decoration:const InputDecoration(labelText:'السمك', border:OutlineInputBorder()), items:[for(final w in [FontWeight.w400,FontWeight.w500,FontWeight.w600,FontWeight.w700,FontWeight.w800]) DropdownMenuItem(value:w, child:Text(w==FontWeight.w400?'عادي':w==FontWeight.w500?'متوسط':w==FontWeight.w600?'شبه عريض':w==FontWeight.w700?'عريض':'عريض جدًا'))], onChanged:(v)=>setDialogState(()=>weight=v??FontWeight.w400))),
            SizedBox(width:150, child:DropdownButtonFormField<TextAlign>(initialValue:align, decoration:const InputDecoration(labelText:'المحاذاة', border:OutlineInputBorder()), items:[for(final a in [TextAlign.start,TextAlign.center,TextAlign.end,TextAlign.justify]) DropdownMenuItem(value:a, child:Text(a==TextAlign.center?'وسط':a==TextAlign.justify?'ضبط':a==TextAlign.end?'نهاية':'بداية'))], onChanged:(v)=>setDialogState(()=>align=v??TextAlign.start))),
            SizedBox(width:150, child:TextField(controller:color, decoration:const InputDecoration(labelText:'لون النص', hintText:'#1E60AA', border:OutlineInputBorder()))),
            SizedBox(width:150, child:TextField(controller:background, decoration:const InputDecoration(labelText:'لون الخلفية', hintText:'#FFFFFF', border:OutlineInputBorder()))),
            SizedBox(width:150, child:TextField(controller:border, decoration:const InputDecoration(labelText:'لون الحدود', hintText:'#D3E4FE', border:OutlineInputBorder()))),
            SizedBox(width:130, child:TextField(controller:borderWidth, keyboardType:const TextInputType.numberWithOptions(decimal:true), decoration:const InputDecoration(labelText:'سمك الحدود', border:OutlineInputBorder()))),
            SizedBox(width:320, child:TextField(controller:customText, decoration:const InputDecoration(labelText:'نص مخصص للهيدر/الفوتر', border:OutlineInputBorder()))),
            Switch(value:visible,onChanged:(v)=>setDialogState(()=>visible=v)),
            const Text('إظهار العنصر'),
          ]),
        ]))),
        actions:[
          TextButton(onPressed:()=>Navigator.of(dialogContext).pop(), child:const Text('إلغاء')),
          FilledButton(onPressed:(){
            QuotationDocumentElementStyle make(){
              return QuotationDocumentElementStyle(fontSizeMultiplier:double.tryParse(size.text.trim())??1,fontWeight:weight,color:color.text.trim().isEmpty?null:color.text.trim(),fontFamily:family.text.trim().isEmpty?null:family.text.trim(),textAlign:align,lineHeight:double.tryParse(lineHeight.text.trim()),backgroundColor:background.text.trim().isEmpty?null:background.text.trim(),borderColor:border.text.trim().isEmpty?null:border.text.trim(),borderWidth:double.tryParse(borderWidth.text.trim())??0,visible:visible,customText:customText.text.trim().isEmpty?null:customText.text.trim());
            }
            final s=make();
            setState((){ _design = _replaceDesign(_design, selected, s); });
            Navigator.of(dialogContext).pop();
          }, child:const Text('حفظ')),
        ],
      );
    }));
    family.dispose(); size.dispose(); color.dispose(); background.dispose(); border.dispose(); borderWidth.dispose(); lineHeight.dispose(); customText.dispose();
  }

  QuotationDocumentDesign _replaceDesign(QuotationDocumentDesign d, String key, QuotationDocumentElementStyle s) {
    return switch(key) {
      'title'=>QuotationDocumentDesign(title:s,company:d.company,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:d.footer,header:d.header),
      'company'=>QuotationDocumentDesign(title:d.title,company:s,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:d.footer,header:d.header),
      'customer'=>QuotationDocumentDesign(title:d.title,company:d.company,customer:s,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:d.footer,header:d.header),
      'sectionTitle'=>QuotationDocumentDesign(title:d.title,company:d.company,customer:d.customer,sectionTitle:s,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:d.footer,header:d.header),
      'tableHeader'=>QuotationDocumentDesign(title:d.title,company:d.company,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:s,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:d.footer,header:d.header),
      'tableCell'=>QuotationDocumentDesign(title:d.title,company:d.company,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:s,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:d.footer,header:d.header),
      'totalsLabel'=>QuotationDocumentDesign(title:d.title,company:d.company,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:s,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:d.footer,header:d.header),
      'totalsValue'=>QuotationDocumentDesign(title:d.title,company:d.company,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:s,finalTotal:d.finalTotal,footer:d.footer,header:d.header),
      'finalTotal'=>QuotationDocumentDesign(title:d.title,company:d.company,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:s,footer:d.footer,header:d.header),
      'footer'=>QuotationDocumentDesign(title:d.title,company:d.company,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:s,header:d.header),
      _=>QuotationDocumentDesign(title:d.title,company:d.company,customer:d.customer,sectionTitle:d.sectionTitle,tableHeader:d.tableHeader,tableCell:d.tableCell,totalsLabel:d.totalsLabel,totalsValue:d.totalsValue,finalTotal:d.finalTotal,footer:d.footer,header:s),
    };
  }

  /// The line columns this offer prints, and the button that changes them.
  Widget _columnsCard'''
if marker not in s: raise SystemExit('design method marker missing')
s = s.replace(marker, design, 1)
p.write_text(s, encoding='utf-8')

# Backend HTML uses the same persisted design instead of fixed-only styling.
p = ROOT / 'backend/src/modules/sales/quotation-document.ts'
s = p.read_text(encoding='utf-8')
marker = '''function quantity(value: string): string {'''
helper = r'''function safeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(v) ? v : null;
}

function safeFont(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 80 || !/^[A-Za-z0-9 _,-]+$/.test(v)) return null;
  return v;
}

function designCss(design: Record<string, unknown> | null | undefined): string {
  if (!design) return '';
  const rules: string[] = [];
  const targets: Record<string, string> = {
    title: '.title-band h2', company: '.brand h1', customer: '.panels .panel',
    sectionTitle: '.section-head h3', tableHeader: '.items thead th', tableCell: '.items tbody td',
    totalsLabel: '.totals td:first-child', totalsValue: '.totals td.num', finalTotal: '.totals tr.grand td',
    header: '.masthead', footer: '.document-footer',
  };
  for (const [key, selector] of Object.entries(targets)) {
    const raw = design[key];
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const css: string[] = [];
    const color = safeColor(v.color); const bg = safeColor(v.backgroundColor); const bc = safeColor(v.borderColor);
    const font = safeFont(v.fontFamily); const size = Number(v.fontSizeMultiplier); const lh = Number(v.lineHeight); const bw = Number(v.borderWidth);
    if (color) css.push(`color:${color}`); if (bg) css.push(`background-color:${bg}`); if (bc && bw > 0) css.push(`border-color:${bc}`);
    if (bw > 0 && bw < 20) css.push(`border-width:${bw}mm`); if (font) css.push(`font-family:${font},Tahoma,Arial,sans-serif`);
    if (Number.isFinite(size) && size >= 0.5 && size <= 3) css.push(`font-size:${size}em`);
    if (Number.isFinite(lh) && lh >= 0.8 && lh <= 3) css.push(`line-height:${lh}`);
    if (typeof v.textAlign === 'string' && ['left','right','center','justify','start','end'].includes(v.textAlign)) css.push(`text-align:${v.textAlign}`);
    if (v.visible === false) css.push('display:none !important');
    if (css.length) rules.push(`${selector}{${css.join(';')}}`);
  }
  return rules.join('\n');
}

function quantity(value: string): string {'''
if marker not in s: raise SystemExit('backend helper marker missing')
s = s.replace(marker, helper, 1)
needle = '''</style>\n</head>'''
replacement = '''${designCss(content.design)}\n</style>\n</head>'''
if needle not in s: raise SystemExit('style close marker missing')
s = s.replace(needle, replacement, 1)
# Give footer a stable selector so the per-element style can target it.
s = s.replace('''<footer class="footer">''', '''<footer class="footer document-footer">''', 1)
p.write_text(s, encoding='utf-8')

print('final quotation design transformations applied')
