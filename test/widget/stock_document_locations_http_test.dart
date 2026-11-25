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
  testWidgets('old stock transfer draft actual read correct save then post', (
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
                File(materialIconsFontPath).readAsBytesSync(),
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
                AppConfig.forLocalServer('http://127.0.0.1:3223/api/v1'),
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
    expect(find.textContaining('3.0000'), findsWidgets);
    await tester.tap(find.text('Source: C-01'));
    await settle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Location'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('A-01 • Aisle A shelf 1').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await settle();
    await tester.tap(find.text('Destination: unlocated'));
    await settle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Location'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('C-01 • C1').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await settle();
    // Changing source intentionally invalidates the old lot. Select it again
    // at the new physical source instead of pretending a refused post worked.
    await tester.tap(find.text('Lot: No lot (choose again)'));
    await settle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Lot'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('L1').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await settle();
    final boundary =
        visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image = await boundary.toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await screenshotFile('stock-document-correction.png')
          .writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
    await tester.tap(find.text('Save locations'));
    await settle();
    expect(find.text('Correct draft locations'), findsNothing);
    await tester.tap(find.byTooltip('Post').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Post').last);
    await settle();
    expect(find.text('Posted'), findsOneWidget);
    expect(find.byTooltip('Post'), findsNothing);
    expect(find.byType(AlertDialog), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 6));
    expect(tester.takeException(), isNull);
  }, skip: Platform.environment['KAYAN_STOCKDOC_LOCATION_UI'] != '1');
}
