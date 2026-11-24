import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import 'dart:convert';
import 'dart:io';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/line_location_picker.dart';
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
  Future<Json> getObject(String path, {Map<String, dynamic>? query}) async =>
      Map<String, dynamic>.from(
        jsonDecode(File('test/fixtures/item_locations.json').readAsStringSync())
            as Map,
      );
}

void main() {
  testWidgets('manual split uses typed line units and retains invalid amounts', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1000, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.runAsync(() async {
      await (FontLoader('IBMPlexSansArabic')..addFont(
            Future.value(
              ByteData.sublistView(
                File('assets/fonts/IBMPlexSansArabic-Regular.ttf')
                    .readAsBytesSync(),
              ),
            ),
          ))
          .load();
    });
    final imageKey = GlobalKey();
    Json? result;
    await tester.pumpWidget(
      RepaintBoundary(
        key: imageKey,
        child: MaterialApp(
          theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await pickLineLocations(
                    context,
                    _Api(),
                    itemId: 'i',
                    lineQuantity: '2',
                    unitName: 'carton',
                    unitFactor: '2',
                    warehouseId: null,
                    initial: [],
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Allocate line quantity: 2 carton'), findsOneWidget);
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), '0.5');
    await tester.enterText(fields.at(1), '0.5');
    await tester.tap(find.text('Use allocation'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Location quantities do not equal'),
      findsOneWidget,
    );
    expect(tester.widget<TextFormField>(fields.at(0)).controller!.text, '0.5');
    await tester.enterText(fields.at(1), '1.5');
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      final image =
          await (imageKey.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary)
              .toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File(
        '${Platform.environment['KAYAN_LOCATION_SHOTS'] ?? Directory.systemTemp.path}/sales-location-picker.png',
      ).writeAsBytesSync(bytes!.buffer.asUint8List());
    });
    await tester.tap(find.text('Use allocation'));
    await tester.pumpAndSettle();
    expect(
      listOf(result!['locationAllocations']).map((r) => r['quantity']).toList(),
      ['0.5', '1.5'],
    );
  });
}
