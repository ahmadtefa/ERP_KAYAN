import 'dart:io';

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
  testWidgets('generic barcode transfer explicit lot create post reverse', (
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
    await tester.tap(find.text('New document'));
    await settle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Kind'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Transfer').last);
    await tester.pumpAndSettle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'To store'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Lot UI target').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('stock-document-barcode')),
      'LOTUI',
    );
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle();
    Future<void> pick(String button, String option) async {
      await tester.tap(find.text(button));
      await settle();
      await tester.tap(
        find.widgetWithText(DropdownButtonFormField<String>, 'Location'),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text(option).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Apply'));
      await settle();
    }

    await pick('Source location: not selected', 'A • A');
    await pick('Destination location: unlocated', 'T • Target');
    await tester.tap(find.text('Lot: not selected'));
    await settle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Lot'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('LOT-UI').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await settle();
    await tester.enterText(find.widgetWithText(TextField, 'Quantity'), '3');
    await tester.tap(find.text('Create'));
    await settle();
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
  }, skip: Platform.environment['KAYAN_STOCKDOC_LOT_UI'] != '1');
}
