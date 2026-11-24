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
    'real sales source edit retains typed carton units on actual API read and save',
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
                AppConfig.forLocalServer('http://127.0.0.1:3220/api/v1'),
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
                kind: InvoiceKind.sales,
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
        find.text(ar ? 'مواقع الصرف (2)' : 'Source locations (2)'),
        findsOneWidget,
      );
      await tester.tap(
        find.text(ar ? 'مواقع الصرف (2)' : 'Source locations (2)'),
      );
      await settle();
      final fields = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextFormField),
      );
      expect(fields, findsNWidgets(2));
      await tester.enterText(fields.at(0), '0.5');
      await tester.enterText(fields.at(1), '1.5');
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        final image =
            await (key.currentContext!.findRenderObject()!
                    as RenderRepaintBoundary)
                .toImage();
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        File(
          '${Platform.environment['KAYAN_LOCATION_SHOTS'] ?? Directory.systemTemp.path}/sales-location-real.png',
        ).writeAsBytesSync(data!.buffer.asUint8List());
      });
      await tester.tap(find.text(ar ? 'اعتماد التوزيع' : 'Use allocation'));
      await settle();
      expect(find.byType(AlertDialog), findsNothing);
      await tester.tap(find.widgetWithText(FilledButton, ar ? 'حفظ' : 'Save'));
      await settle();
      expect(find.textContaining('Could not'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 6));
      expect(tester.takeException(), isNull);
    },
    skip: Platform.environment['KAYAN_SALES_LOCATION_UI'] != '1',
  );
}
