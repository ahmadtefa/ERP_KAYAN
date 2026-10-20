import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/json/amount_format.dart';
import 'package:erp_kayan/shared/widgets/records_table.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Text at its largest must not be clipped, overlap or push a control off the
/// edge - in either direction. These are the layouts that broke first when a
/// scale was applied carelessly: a fixed-height button row, a table row with
/// a tight height, and a header that reserved one line.
void main() {
  Widget wrap(Widget child, {double scale = 1.4, Locale locale = const Locale('en')}) {
    return MaterialApp(
      locale: locale,
      theme: AppTheme.light(textScale: scale),
      builder: (context, inner) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
        ),
        child: inner ?? const SizedBox.shrink(),
      ),
      home: Scaffold(body: child),
    );
  }

  /// A text overflow is reported as an exception by the framework; fail on it
  /// rather than let a yellow-and-black banner pass as a layout.
  void expectNoOverflow(WidgetTester tester) {
    expect(tester.takeException(), isNull);
  }

  testWidgets('a wrapping button row keeps every button on screen at 140%', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(900, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      wrap(
        Padding(
          padding: const EdgeInsets.all(16),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final label in [
                'Print preview',
                'Download PDF',
                'Export Excel',
                'Export CSV',
                'Revise quotation',
                'Convert to invoice',
              ])
                FilledButton.icon(
                  onPressed: () {},
                  icon: const Icon(Icons.check, size: 18),
                  label: Text(label),
                ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expectNoOverflow(tester);
    for (final label in [
      'Print preview',
      'Download PDF',
      'Export Excel',
      'Export CSV',
      'Revise quotation',
      'Convert to invoice',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
  });

  testWidgets('a fixed-height control grows instead of clipping its label', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(500, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      wrap(
        Center(
          child: SizedBox(
            width: 160,
            child: FilledButton(
              onPressed: () {},
              child: const Text(
                'Convert to invoice and post',
                textAlign: TextAlign.center,
                maxLines: 2,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expectNoOverflow(tester);
    expect(find.text('Convert to invoice and post'), findsOneWidget);
  });

  testWidgets('a table row at 140% still shows its numbers', (tester) async {
    await tester.binding.setSurfaceSize(const Size(900, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final rows = <Map<String, dynamic>>[
      {
        'code': 'IT-001',
        'name': 'Rack server with a long descriptive name',
        'total': '1,250.00',
      },
      {'code': 'IT-002', 'name': 'Installation', 'total': '300.00'},
    ];

    await tester.pumpWidget(
      wrap(
        
        SingleChildScrollView(
          child: RecordsTable(
            columns: [
              ColumnSpec('Code', value: (row) => '${row['code']}'),
              ColumnSpec(
                'Description',
                value: (row) => '${row['name']}',
                flex: 3,
              ),
              ColumnSpec(
                'Total',
                value: (row) => '${row['total']}',
                numeric: true,
                emphasise: true,
              ),
            ],
            rows: rows,
            onTap: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expectNoOverflow(tester);
    expect(find.text('IT-001'), findsOneWidget);
    expect(find.text('1,250.00'), findsOneWidget);
  });

  testWidgets('Arabic at 140% lays out right-to-left without overflow', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(700, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      wrap(
        Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'عرض سعر رقم QT-2026-0007',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton(onPressed: () {}, child: const Text('معاينة الطباعة')),
                    OutlinedButton(onPressed: () {}, child: const Text('تنزيل PDF')),
                    OutlinedButton(onPressed: () {}, child: const Text('إرسال العرض')),
                  ],
                ),
                const SizedBox(height: 8),
                const Text(
                  'سيرفر رفّي بمعالجين وذاكرة 64 جيجابايت ومزود طاقة احتياطي وضمان ثلاثة أعوام.',
                ),
              ],
            ),
          ),
        ),
        scale: 1.4,
        locale: const Locale('ar'),
      ),
    );
    await tester.pumpAndSettle();

    expectNoOverflow(tester);
    expect(find.text('عرض سعر رقم QT-2026-0007'), findsOneWidget);
    expect(find.text('سيرفر رفّي بمعالجين وذاكرة 64 جيجابايت ومزود طاقة احتياطي وضمان ثلاثة أعوام.'), findsOneWidget);
  });

  testWidgets('the largest size stays inside a 1000x700 window', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1000, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      wrap(
        Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Settings', style: TextStyle(fontSize: 24)),
              const SizedBox(height: 4),
              const Text('Company, language and appearance.'),
              const SizedBox(height: 16),
              TextField(
                decoration: const InputDecoration(
                  labelText: 'Company name',
                  helperText: 'Shown on every printed document',
                ),
                controller: TextEditingController(text: 'KAYAN Integrated Solutions'),
              ),
              const SizedBox(height: 16),
              const Divider(),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {},
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('Save changes'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expectNoOverflow(tester);
    // The helper text is still painted, not swallowed by the decoration.
    expect(find.text('Shown on every printed document'), findsOneWidget);
  });

  test('the amount formatter is unaffected by a text scale', () {
    // Font size is presentation; money is data. This guards the boundary.
    expect(formatAmount('1250.0000', locale: 'en'), '1,250.00');
  });
}
