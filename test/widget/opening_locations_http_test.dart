import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';

import 'package:flutter/services.dart';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/opening_balance_draft_dialog.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/opening_balances_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  testWidgets('actual opening draft read post', (tester) async {
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
    tester.view.physicalSize = const Size(1600, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = ApiClient(
      AppConfig.forLocalServer('http://127.0.0.1:3225/api/v1'),
      FakeTokenStore(),
    );
    const user = AppUser(
      id: '33333333-3333-4333-8333-333333333333',
      username: 'test',
      fullName: 'Synthetic',
      companyId: '11111111-1111-4111-8111-111111111111',
      isSuperAdmin: true,
    );
    final visualKey = GlobalKey();
    Widget app(Widget home) => ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(user),
      ],
      child: MaterialApp(
        theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: RepaintBoundary(key: visualKey, child: home),
        ),
      ),
    );
    await tester.pumpWidget(
      app(
        Builder(
          builder: (context) => TextButton(
            onPressed: () => showOpeningBalanceDraft(context, api, user),
            child: const Text('Open'),
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
    await tester.tap(find.text('Open'));
    await settle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Branch'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Opening UI branch').last);
    await tester.pumpAndSettle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Stock item'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Opening UI item').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Quantity'), '5');
    await tester.enterText(find.widgetWithText(TextField, 'Unit cost'), '2');
    await tester.tap(find.text('Opening location: unlocated'));
    await settle();
    await tester.tap(
      find.widgetWithText(DropdownButtonFormField<String>, 'Location'),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('A-UI - Opening UI shelf').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await settle();
    await tester.tap(find.text('Save draft for review'));
    await settle();
    final rows = await tester.runAsync(
      () => api.getObject('/accounting/opening-balances'),
    );
    final id = ((rows!['items'] as List).single as Map)['id'] as String;
    await tester.pumpWidget(app(OpeningBalancesScreen(documentId: id)));
    await settle();
    expect(find.text('Draft'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Post'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Post').last);
    await settle();
    expect(find.text('Posted'), findsOneWidget);
    final boundary =
        visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image = await boundary.toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await screenshotFile('opening-document-posted.png')
          .writeAsBytes(bytes!.buffer.asUint8List());
    });
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 6));
    expect(tester.takeException(), isNull);
  }, skip: Platform.environment['KAYAN_OB_LOCATION_UI'] != '1');
}
