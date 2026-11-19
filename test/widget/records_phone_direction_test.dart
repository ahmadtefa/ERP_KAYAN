import 'package:erp_kayan/shared/widgets/records_table.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final width in [500.0, 1200.0]) {
    testWidgets('phone remains left to right in Arabic at width $width', (tester) async {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Directionality(
            textDirection: TextDirection.rtl,
            child: Scaffold(
              body: RecordsTable(
                rows: const [
                  {'name': 'شركة النور', 'phone': '+20 100 000 0001'},
                ],
                columns: [
                  ColumnSpec('الاسم', value: (r) => r['name'] as String?),
                  ColumnSpec(
                    'الهاتف',
                    value: (r) => r['phone'] as String?,
                    textDirection: TextDirection.ltr,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      final phone = tester.widget<Text>(find.text('+20 100 000 0001'));
      expect(phone.textDirection, TextDirection.ltr);
      expect(tester.takeException(), isNull);
    });
  }
}
