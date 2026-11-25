import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_documents_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  testWidgets('existing transfer draft explicit lot split save post reverse', (
    tester,
  ) async {
    HttpOverrides.global = null;
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
      await (FontLoader('MaterialIcons')..addFont(
            Future.value(
              ByteData.sublistView(
                File(
                  '/tmp/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
                ).readAsBytesSync(),
              ),
            ),
          ))
          .load();
    });
    final visualKey = GlobalKey();
    tester.view.physicalSize = const Size(1600, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      RepaintBoundary(
        key: visualKey,
        child: ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(
              ApiClient(
                AppConfig.forLocalServer('http://127.0.0.1:3227/api/v1'),
                FakeTokenStore(),
              ),
            ),
            currentUserProvider.overrideWithValue(
              const AppUser(
                id: '33333333-3333-4333-8333-333333333333',
                username: 'test',
                fullName: 'Synthetic',
                companyId: '11111111-1111-4111-8111-111111111111',
                branchId: '22222222-2222-4222-8222-222222222222',
                permissions: ['inventory.stock.read', 'inventory.stock.adjust'],
              ),
            ),
          ],
          child: MaterialApp(
            theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: StockDocumentsScreen()),
          ),
        ),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 10; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 60)),
        );
        await tester.pump(const Duration(milliseconds: 100));
      }
      await tester.pumpAndSettle();
    }

    await settle();
    await tester.tap(find.byTooltip('Correct draft locations').first);
    await settle();
    await tester.tap(find.text('Split line quantity'));
    await settle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Part 1 quantity'),
      '2',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Part 2 quantity'),
      '1',
    );
    for (var i = 1; i <= 2; i++) {
      await tester.tap(find.text('Part $i lot: not selected'));
      await settle();
      await tester.tap(
        find.widgetWithText(DropdownButtonFormField<String>, 'Lot'),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('LOT-UI').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Apply'));
      await settle();
    }
    await tester.tap(find.text('Apply split'));
    await settle();
    expect(find.textContaining('2 × LOT-UI + 1 × LOT-UI'), findsOneWidget);
    final boundary =
        visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image = await boundary.toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await File('/downloads/stock-document-lot-split.png')
          .writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
    await tester.tap(find.text('Save locations'));
    await settle();
    expect(find.textContaining('Synthetic refusal'), findsOneWidget);
    expect(find.textContaining('2 × LOT-UI + 1 × LOT-UI'), findsOneWidget);
    await tester.tap(find.text('Save locations'));
    await settle();
    expect(find.text('Correct draft locations'), findsNothing);
    await tester.tap(find.byTooltip('Post').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Post').last);
    await settle();
    await tester.tap(find.byTooltip('Reverse').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Reverse').last);
    await settle();
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 6));
    expect(tester.takeException(), isNull);
  }, skip: Platform.environment['KAYAN_STOCKDOC_SPLIT_UI'] != '1');
}
