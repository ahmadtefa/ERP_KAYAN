import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/records_table.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// A long, wide table (the stock-by-branch report has 1,500 rows and eight
/// columns) must show its sideways scroll bar inside the visible frame, not
/// below the last row. This is the regression the user hit: columns were cut
/// off at the screen edge and no bar was visible to drag.
Future<void> _loadFonts() async {
  final loader = FontLoader('IBMPlexSansArabic');
  for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    final bytes = await File('assets/fonts/IBMPlexSansArabic-$weight.ttf')
        .readAsBytes();
    loader.addFont(Future.value(ByteData.sublistView(bytes)));
  }
  await loader.load();
}

void main() {
  testWidgets('wide long table keeps its horizontal bar on screen', (
    tester,
  ) async {
    await tester.runAsync(_loadFonts);
    tester.view.physicalSize = const Size(1000, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final key = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: key,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.dark(),
          locale: const Locale('ar'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: RecordsTable(
              columns: [
                for (final name in [
                  'branchCode',
                  'branchNameEn',
                  'itemCode',
                  'itemNameEn',
                  'itemNameAr',
                  'unit',
                  'quantity',
                  'value',
                ])
                  ColumnSpec(name, value: (row) => '${row[name]}'),
              ],
              rows: [
                for (var i = 0; i < 1500; i++)
                  {
                    'branchCode': 'ALX',
                    'branchNameEn': 'Alexandria Branch',
                    'itemCode': 'MNT-${i + 1}',
                    'itemNameEn':
                        'Mounting structure for 4 solar panels, adjustable',
                    'itemNameAr': 'هيكل مزرعة لأربعة ألواح شمسية قابل للضبط',
                    'unit': 'قطعة',
                    'quantity': '$i.0000',
                    'value': '${i * 12}.0000',
                  },
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Both axes scroll and the horizontal bar is a direct child of the frame.
    final scrollables = tester
        .widgetList<Scrollable>(find.byType(Scrollable))
        .toList();
    expect(scrollables.where((s) => s.axis == Axis.horizontal), hasLength(1));
    expect(scrollables.where((s) => s.axis == Axis.vertical), hasLength(1));
    final h = scrollables
        .firstWhere((s) => s.axis == Axis.horizontal)
        .controller!;
    expect(h.position.maxScrollExtent, greaterThan(0));

    // The bar sits at the bottom edge of the visible frame, at row 0 of 1500.
    final bar = find.byType(Scrollbar).first;
    expect(tester.getBottomLeft(bar).dy, closeTo(600, 1));

    Future<void> shot(String name) async {
      await tester.runAsync(() async {
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final image = await boundary.toImage();
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        final dir = Directory(
          Platform.environment['KAYAN_SHOT_DIR'] ?? '/tmp/shots',
        )..createSync(recursive: true);
        File('${dir.path}/$name.png')
            .writeAsBytesSync(data!.buffer.asUint8List());
      });
    }

    await shot('table-before-scroll');
    h.jumpTo(h.position.maxScrollExtent);
    await tester.pumpAndSettle();
    await shot('table-scrolled-to-end');
    expect(h.offset, h.position.maxScrollExtent);

    // Scroll to the very last row: it must end above the horizontal bar.
    final v = scrollables
        .firstWhere((s) => s.axis == Axis.vertical)
        .controller!;
    v.jumpTo(v.position.maxScrollExtent);
    await tester.pumpAndSettle();
    await shot('table-last-row');
    final last = find.text('1499.0000');
    expect(last, findsOneWidget);
    expect(tester.getBottomLeft(last).dy, lessThan(600 - 16));
  });
}
