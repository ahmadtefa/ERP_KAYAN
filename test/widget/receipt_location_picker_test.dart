import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/receipt_location_picker.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api()
    : super(
        AppConfig.forLocalServer('http://localhost:3210/api/v1'),
        FakeTokenStore(),
      );
  @override
  Future<List<Json>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => path.endsWith('/warehouses')
      ? [
          {'id': 'w', 'code': 'W', 'nameEn': 'Warehouse', 'isActive': true},
        ]
      : [
          {
            'id': 'a',
            'warehouseId': 'w',
            'code': 'EMPTY',
            'nameEn': 'Empty active shelf',
            'isActive': true,
          },
          {
            'id': 'b',
            'warehouseId': 'w',
            'code': 'OFF',
            'nameEn': 'Inactive shelf',
            'isActive': false,
          },
          {
            'id': 'c',
            'warehouseId': 'elsewhere',
            'code': 'OTHER',
            'nameEn': 'Other warehouse',
            'isActive': true,
          },
        ];
}

void main() {
  Future<void> open(
    WidgetTester tester,
    void Function(Json?) result, {
    String? initial,
  }) async {
    tester.view.physicalSize = const Size(1000, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async => result(
                await pickReceiptLocation(
                  context,
                  _Api(),
                  warehouseId: 'w',
                  storageLocationId: initial,
                ),
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'receipt chooser includes empty active shelf, excludes inactive and other warehouse',
    (tester) async {
      Json? value;
      await open(tester, (v) => value = v);
      await tester.tap(find.byType(DropdownButtonFormField<String>).last);
      await tester.pumpAndSettle();
      expect(find.text('EMPTY • Empty active shelf'), findsOneWidget);
      expect(find.textContaining('Inactive shelf'), findsNothing);
      expect(find.textContaining('Other warehouse'), findsNothing);
      await tester.tap(find.text('EMPTY • Empty active shelf'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();
      expect(value, {'warehouseId': 'w', 'storageLocationId': 'a'});
    },
  );
  testWidgets(
    'unavailable saved receipt destination is not silently replaced',
    (tester) async {
      Json? value;
      await open(tester, (v) => value = v, initial: 'b');
      expect(
        find.textContaining('saved destination is unavailable'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Apply'))
            .onPressed,
        isNull,
      );
      await tester.tap(find.text('Clear location'));
      await tester.pumpAndSettle();
      expect(value, {'warehouseId': 'w', 'storageLocationId': null});
    },
  );
}
