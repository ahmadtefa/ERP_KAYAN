import 'dart:io';

import 'package:flutter/services.dart';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_takes_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  testWidgets('actual count add record finish', (tester) async {
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
                AppConfig.forLocalServer('http://127.0.0.1:3224/api/v1'),
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
                permissions: [
                  'inventory.stocktake.read',
                  'inventory.stocktake.count',
                ],
              ),
            ),
          ],
          child: MaterialApp(
            theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: StockTakesScreen()),
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
    await tester.tap(find.textContaining('STK-').first);
    await settle();
    await tester.tap(find.text('Add count location'));
    await settle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Item and batch'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('IT-1 | L1').last);
    await tester.pumpAndSettle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Location'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('C-01 - C1').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add location'));
    await settle();
    Future<void> count(String label, String value) async {
      final card = find.ancestor(
        of: find.text(label),
        matching: find.byType(Card),
      );
      final field = find.descendant(
        of: card,
        matching: find.byType(TextFormField),
      );
      await tester.ensureVisible(field);
      await tester.enterText(field, value);
    }

    await count('Location: A-01 - Aisle A shelf 1', '6');
    await count('Location: B-01 - B1', '4');
    await count('Location: Unlocated stock', '0');
    await count('Location: C-01 - C1', '3');
    await tester.tap(find.text('Save count'));
    await settle();
    await tester.tap(find.text('Finish & review'));
    await settle();
    expect(find.text('Status: REVIEW'), findsOneWidget);
    expect(find.textContaining('Assigned, no added stock: 3'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 6));
    expect(tester.takeException(), isNull);
  }, skip: Platform.environment['KAYAN_COUNT_LOCATION_UI'] != '1');
}
