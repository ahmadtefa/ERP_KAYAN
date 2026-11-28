import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import 'dart:convert';
import 'dart:io';

import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/item_locations_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api(this.data)
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  final Json data;
  int calls = 0;
  bool failPost = false;
  bool uncertainPost = false;
  final posted = <Json>[];
  @override
  Future<List<Json>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [
    {'id': 'dest', 'code': 'DEST', 'nameEn': 'Destination', 'isActive': true},
  ];
  @override
  Future<Json> post(String path, {Object? body, String? idempotencyKey}) async {
    if (uncertainPost) throw StateError('INTERNAL_DIAGNOSTIC');
    if (failPost) {
      throw const ApiFailure(
        'Insufficient stock. Reduce quantity.',
        statusCode: 400,
      );
    }
    posted.add(Map<String, dynamic>.from(body as Map));
    return {};
  }

  bool fail = false;
  @override
  Future<Json> getObject(String path, {Map<String, dynamic>? query}) async {
    calls++;
    if (fail) throw Exception('Location balances unavailable');
    expect(path, '/inventory/locations/item/item-1');
    return data;
  }
}

void main() {
  Future<void> pump(WidgetTester tester, _Api api) async {
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            const AppUser(
              id: 'u',
              username: 'u',
              fullName: 'u',
              companyId: 'c',
              permissions: ['inventory.stock.adjust'],
            ),
          ),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const ItemLocationsScreen(itemId: 'item-1', itemName: 'Cable'),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('item locations honestly shows empty scoped warehouses', (
    tester,
  ) async {
    await pump(tester, _Api({'warehouses': []}));
    expect(
      find.textContaining(
        'No stock for this item in the warehouses you may view.',
      ),
      findsOneWidget,
    );
  });
  testWidgets('item locations refresh reloads authoritative balances', (
    tester,
  ) async {
    final api = _Api({'warehouses': []});
    await pump(tester, api);
    await tester.tap(find.byTooltip('Refresh balances'));
    await tester.pumpAndSettle();
    expect(api.calls, 2);
  });
  testWidgets(
    'split-location quantities and historical deficit remain visible',
    (tester) async {
      final data = Map<String, dynamic>.from(
        jsonDecode(File('test/fixtures/item_locations.json').readAsStringSync())
            as Map,
      );
      final warehouses = listOf(data['warehouses']);
      (warehouses.first['unlocated'] as Map)['quantity'] = '-2.0000';
      await pump(tester, _Api(data));
      expect(find.text('W1 • Main'), findsOneWidget);
      expect(find.text('A-01 • Aisle A shelf 1'), findsOneWidget);
      expect(find.text('B-01 • B1'), findsOneWidget);
      expect(
        find.textContaining('Historical location allocation deficit.'),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'assign has quantity guard, preserves rejected input and sends neutral contract',
    (tester) async {
      final data = Map<String, dynamic>.from(
        jsonDecode(File('test/fixtures/item_locations.json').readAsStringSync())
            as Map,
      );
      final api = _Api(data)..failPost = true;
      await pump(tester, api);
      await tester.tap(find.text('Assign location'));
      await tester.pumpAndSettle();
      final dropdown = find.byType(DropdownButtonFormField<String>);
      await tester.tap(dropdown);
      await tester.pumpAndSettle();
      await tester.tap(find.text('DEST • Destination').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '8',
      );
      await tester.tap(find.text('Save allocation'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Quantity exceeds available stock.'),
        findsOneWidget,
      );
      expect(api.posted, isEmpty);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '4',
      );
      await tester.tap(find.text('Save allocation'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Your entries are retained.'), findsOneWidget);
      expect(
        tester
            .widget<TextFormField>(
              find.widgetWithText(TextFormField, 'Quantity'),
            )
            .controller!
            .text,
        '4',
      );
      api.failPost = false;
      await tester.tap(find.text('Save allocation'));
      await tester.pumpAndSettle();
      expect(
        api.posted.single['warehouseId'],
        '44444444-4444-4444-8444-444444444444',
      );
      expect(api.posted.single['quantity'], '4');
      expect(api.posted.single['toLocationId'], 'dest');
    },
  );
  testWidgets(
    'historical deficit correction requires physical source and reason',
    (tester) async {
      final data = Map<String, dynamic>.from(
        jsonDecode(File('test/fixtures/item_locations.json').readAsStringSync())
            as Map,
      );
      final unknown = (data['warehouses'] as List).first['unlocated'] as Map;
      unknown['quantity'] = '-2.0000';
      (unknown['lots'] as List).first['quantity'] = '-2.0000';
      final api = _Api(data);
      await pump(tester, api);
      await tester.tap(find.text('Correct historical allocation'));
      await tester.pumpAndSettle();
      expect(find.text('Verified physical source location'), findsOneWidget);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('DEST • Destination').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '2',
      );
      await tester.tap(find.text('Save allocation'));
      await tester.pumpAndSettle();
      expect(api.posted, isEmpty);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Reason'),
        'Physical movement checked',
      );
      await tester.tap(find.text('Save allocation'));
      await tester.pumpAndSettle();
      expect(api.posted.single['fromLocationId'], 'dest');
      expect(api.posted.single.containsKey('toLocationId'), false);
      expect(api.posted.single['quantity'], '2');
    },
  );

  testWidgets(
    'warehouse capability denies assignment despite general adjust permission',
    (tester) async {
      final data = Map<String, dynamic>.from(
        jsonDecode(File('test/fixtures/item_locations.json').readAsStringSync())
            as Map,
      );
      (data['warehouses'] as List).first['canAllocate'] = false;
      await pump(tester, _Api(data));
      expect(find.text('Assign location'), findsNothing);
      expect(find.text('Move'), findsNothing);
    },
  );

  testWidgets('cancel allocation closes dialog without changing stock', (tester) async {
    final data=Map<String,dynamic>.from(jsonDecode(File('test/fixtures/item_locations.json').readAsStringSync()) as Map);
    final api=_Api(data);await pump(tester,api);
    await tester.tap(find.text('Assign location'));await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField,'Quantity'),'4');
    await tester.tap(find.text('Cancel'));await tester.pumpAndSettle();
    expect(find.text('Assign existing stock'),findsNothing);expect(api.posted,isEmpty);
  });

  testWidgets('uncertain relocation blocks duplicate save and keeps input', (
    tester,
  ) async {
    final data = Map<String, dynamic>.from(
      jsonDecode(File('test/fixtures/item_locations.json').readAsStringSync())
          as Map,
    );
    final api = _Api(data)..uncertainPost = true;
    await pump(tester, api);
    await tester.tap(find.text('Assign location'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DEST • Destination').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '4');
    await tester.tap(find.text('Save allocation'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('The operation may have completed.'),
      findsOneWidget,
    );
    expect(find.textContaining('INTERNAL_DIAGNOSTIC'), findsNothing);
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Save allocation'),
          )
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<TextFormField>(find.widgetWithText(TextFormField, 'Quantity'))
          .controller!
          .text,
      '4',
    );
  });

  testWidgets('Arabic compact locations remains readable', (tester) async {
    final data = Map<String, dynamic>.from(
      jsonDecode(File('test/fixtures/item_locations.json').readAsStringSync())
          as Map,
    );
    tester.view.physicalSize = const Size(460, 900);
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
    final key = GlobalKey();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(_Api(data))],
        child: RepaintBoundary(
          key: key,
          child: MaterialApp(
            theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
            locale: const Locale('ar'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const ItemLocationsScreen(
              itemId: 'item-1',
              itemName: 'صنف تجريبي',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('W1 • رئيسي'), findsOneWidget);
    expect(find.text('A-01 • ممر أ رف ١'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.runAsync(() async {
      final image =
          await (key.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary)
              .toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File(
        '${Platform.environment['KAYAN_LOCATION_SHOTS'] ?? Directory.systemTemp.path}/location-arabic-compact.png',
      ).writeAsBytesSync(bytes!.buffer.asUint8List());
    });
  });
}
