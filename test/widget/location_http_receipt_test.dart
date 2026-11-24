import 'package:erp_kayan/features/inventory/presentation/screens/item_locations_screen.dart';

import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/batches_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/storage_locations_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  testWidgets('isolated receipt HTTP to actual service and location balance', (
    tester,
  ) async {
    HttpOverrides.global = null;
    tester.view.physicalSize = const Size(1400, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.runAsync(() async {
      final font = FontLoader('IBMPlexSansArabic')
        ..addFont(
          Future.value(
            ByteData.sublistView(
              File('assets/fonts/IBMPlexSansArabic-Regular.ttf')
                  .readAsBytesSync(),
            ),
          ),
        );
      await font.load();
      var dir = File(Platform.resolvedExecutable).parent;
      while (dir.path != dir.parent.path) {
        final icon = File(
          '${dir.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
        );
        if (icon.existsSync()) {
          await (FontLoader('MaterialIcons')..addFont(
                Future.value(ByteData.sublistView(icon.readAsBytesSync())),
              ))
              .load();
          break;
        }
        dir = dir.parent;
      }
    });
    final key = GlobalKey();
    final navigator = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(
            ApiClient(
              AppConfig.forLocalServer('http://127.0.0.1:3219/api/v1'),
              FakeTokenStore(),
            ),
          ),
          currentUserProvider.overrideWithValue(
            const AppUser(
              id: '33333333-3333-4333-8333-333333333333',
              username: 'isolated',
              fullName: 'Synthetic only',
              companyId: '11111111-1111-4111-8111-111111111111',
              branchId: '22222222-2222-4222-8222-222222222222',
              permissions: [
                'inventory.batches.read',
                'inventory.batches.receive',
                'inventory.items.read',
                'inventory.warehouses.read',
                'inventory.warehouses.manage',
                'inventory.stock.adjust',
              ],
            ),
          ),
        ],
        child: RepaintBoundary(
          key: key,
          child: MaterialApp(
            theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
            navigatorKey: navigator,
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: BatchesScreen()),
          ),
        ),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 12; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pump(const Duration(milliseconds: 100));
      }
      await tester.pumpAndSettle();
    }

    Future<void> shot(String name) async {
      await tester.runAsync(() async {
        final image =
            await (key.currentContext!.findRenderObject()!
                    as RenderRepaintBoundary)
                .toImage();
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        File(
          '${Platform.environment['KAYAN_LOCATION_SHOTS'] ?? Directory.systemTemp.path}/location-$name.png',
        ).writeAsBytesSync(data!.buffer.asUint8List());
      });
    }

    await settle();
    await tester.tap(find.text('Receive'));
    await settle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Batch number'),
      'UI-ISOLATED-RECEIPT',
    );
    await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '3');
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Unit cost'),
      '4.25',
    );
    final field = find
        .ancestor(
          of: find.text('Storage location (optional)'),
          matching: find.byType(InputDecorator),
        )
        .first;
    await tester.ensureVisible(field);
    await tester.tap(field);
    await settle();
    await shot('menu');
    await tester.tap(find.text('A-01 • Aisle A shelf 1').last);
    await settle();
    await shot('selected');
    final receive = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text('Receive'),
    );
    await tester.ensureVisible(receive);
    await tester.tap(receive);
    await settle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('UI-ISOLATED-RECEIPT'), findsOneWidget);
    expect(find.textContaining('Aisle A shelf 1'), findsOneWidget);
    await shot('received');
    navigator.currentState!.push(
      MaterialPageRoute<void>(
        builder: (_) => const Scaffold(body: StorageLocationsScreen()),
      ),
    );
    await settle();
    expect(find.text('Aisle A shelf 1'), findsOneWidget);
    await shot('balance');
    navigator.currentState!.push(
      MaterialPageRoute<void>(
        builder: (_) => const ItemLocationsScreen(
          itemId: '66666666-6666-4666-8666-666666666666',
          itemName: 'Milk',
        ),
      ),
    );
    await settle();
    expect(find.text('W1 • Main'), findsOneWidget);
    expect(find.text('A-01 • Aisle A shelf 1'), findsOneWidget);
    await shot('item-detail');
    await tester.tap(find.text('Move'));
    await settle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await settle();
    await tester.tap(find.text('B-01 • Destination').last);
    await settle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '1');
    await tester.tap(find.text('Save allocation'));
    await settle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('B-01 • Destination'), findsOneWidget);
    await shot('item-split');
    await tester.tap(find.text('Assign location'));
    await settle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await settle();
    await tester.tap(find.text('B-01 • Destination').last);
    await settle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '2');
    await tester.tap(find.text('Save allocation'));
    await settle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('Warehouse total: 5'), findsOneWidget);
    await shot('item-assigned');

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 5));
    expect(tester.takeException(), isNull);
  }, skip: Platform.environment['KAYAN_LOCATION_UI'] != '1');
}
