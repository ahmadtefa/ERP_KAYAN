import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  testWidgets(
    'real purchase destination edit uses actual API read and draft save',
    (tester) async {
      final ar = Platform.environment['KAYAN_ARABIC_COMPACT'] == '1';
      HttpOverrides.global = null;
      tester.view.physicalSize =
          Platform.environment['KAYAN_ARABIC_COMPACT'] == '1'
          ? const Size(700, 1100)
          : const Size(1600, 1200);
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
      await tester.runAsync(() async {
        var dir = File(Platform.resolvedExecutable).parent;
        while (dir.path != dir.parent.path) {
          final file = File(
            '${dir.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
          );
          if (file.existsSync()) {
            await (FontLoader('MaterialIcons')..addFont(
                  Future.value(ByteData.sublistView(file.readAsBytesSync())),
                ))
                .load();
            break;
          }
          dir = dir.parent;
        }
      });
      final key = GlobalKey();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(
              ApiClient(
                AppConfig.forLocalServer('http://127.0.0.1:3221/api/v1'),
                FakeTokenStore(),
              ),
            ),
          ],
          child: RepaintBoundary(
            key: key,
            child: MaterialApp(
              theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
              locale: ar ? const Locale('ar') : const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const InvoiceEditorScreen(
                kind: InvoiceKind.purchase,
                invoiceId: 'current',
              ),
            ),
          ),
        ),
      );
      Future<void> settle() async {
        for (var i = 0; i < 12; i++) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 60)),
          );
          await tester.pump(const Duration(milliseconds: 100));
        }
        await tester.pumpAndSettle();
      }

      await settle();
      expect(
        find.text(ar ? 'موقع الاستلام: محدد' : 'Receiving location: selected'),
        findsOneWidget,
      );
      await tester.tap(
        find.text(ar ? 'موقع الاستلام: محدد' : 'Receiving location: selected'),
      );
      await settle();
      await tester.tap(find.byType(DropdownButtonFormField<String>).last);
      await settle();
      await tester.tap(find.textContaining('B-01').last);
      await settle();
      await tester.runAsync(() async {
        final image =
            await (key.currentContext!.findRenderObject()!
                    as RenderRepaintBoundary)
                .toImage();
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        File(
          '${Platform.environment['KAYAN_LOCATION_SHOTS'] ?? Directory.systemTemp.path}/purchase-location-real.png',
        ).writeAsBytesSync(data!.buffer.asUint8List());
        image.dispose();
      });
      await tester.tap(find.text(ar ? 'تطبيق' : 'Apply'));
      await settle();
      expect(find.byType(AlertDialog), findsNothing);
      await tester.enterText(find.byKey(ValueKey('purchase-batch-0-55555555-5555-4555-8555-555555555555')), 'UI-PURCHASE-LOT');
      await tester.enterText(find.byKey(ValueKey('purchase-production-0-55555555-5555-4555-8555-555555555555')), '2026-11-01');
      await tester.enterText(find.byKey(ValueKey('purchase-expiry-0-55555555-5555-4555-8555-555555555555')), '2027-04-01');
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        final image = await (key.currentContext!.findRenderObject()! as RenderRepaintBoundary).toImage();
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        File('${Platform.environment['KAYAN_LOCATION_SHOTS'] ?? Directory.systemTemp.path}/purchase-lot-form-${ar ? 'ar' : 'desktop'}.png').writeAsBytesSync(data!.buffer.asUint8List());
        image.dispose();
      });
      await tester.tap(find.widgetWithText(FilledButton, ar ? 'حفظ' : 'Save'));
      await settle();
      expect(find.textContaining('Could not'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 6));
      expect(tester.takeException(), isNull);
    },
    skip: Platform.environment['KAYAN_PURCHASE_LOCATION_UI'] != '1',
  );
}
