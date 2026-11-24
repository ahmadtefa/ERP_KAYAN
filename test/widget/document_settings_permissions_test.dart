import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/widgets/document_settings_card.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> openSettings(
  WidgetTester tester, {
  required bool superAdmin,
}) async {
  final user = AppUser(
    id: 'synthetic',
    username: 'synthetic',
    fullName: 'Synthetic',
    companyId: 'company',
    permissions: const ['reports.read', 'admin.company.manage'],
    isSuperAdmin: superAdmin,
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        currentUserProvider.overrideWithValue(user),
        companySettingsProvider.overrideWith(
          (ref) async => {
            'maxDiscountPercent': '100',
            'showTaxIdOnQuotations': true,
          },
        ),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: DocumentSettingsCard()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('delegated company permission is read-only without super admin', (
    tester,
  ) async {
    await openSettings(tester, superAdmin: false);
    expect(
      find.text('Only the super administrator can change these settings.'),
      findsOneWidget,
    );
    expect(find.text('Save settings'), findsNothing);
    expect(
      tester
          .widget<TextField>(
            find.widgetWithText(TextField, 'Maximum discount %'),
          )
          .enabled,
      isFalse,
    );
  });
  testWidgets('super administrator can edit the document settings', (
    tester,
  ) async {
    await openSettings(tester, superAdmin: true);
    expect(find.text('Save settings'), findsOneWidget);
    expect(
      tester
          .widget<TextField>(
            find.widgetWithText(TextField, 'Maximum discount %'),
          )
          .enabled,
      isTrue,
    );
  });
  testWidgets(
    'non-finite, exponent, range and excess precision stay inline before request',
    (tester) async {
      await openSettings(tester, superAdmin: true);
      for (final invalid in [
        'NaN',
        'Infinity',
        '1e2',
        '-1',
        '101',
        '0.12345',
      ]) {
        await tester.enterText(
          find.widgetWithText(TextField, 'Maximum discount %'),
          invalid,
        );
        await tester.tap(find.text('Save settings'));
        await tester.pumpAndSettle();
        final field = tester.widget<TextField>(
          find.widgetWithText(TextField, 'Maximum discount %'),
        );
        expect(field.decoration!.errorText, isNotNull, reason: invalid);
        expect(field.controller!.text, invalid);
      }
      await tester.enterText(
        find.widgetWithText(TextField, 'Maximum discount %'),
        '75.1250',
      );
      await tester.pump();
      expect(
        tester
            .widget<TextField>(
              find.widgetWithText(TextField, 'Maximum discount %'),
            )
            .decoration!
            .errorText,
        isNull,
      );
    },
  );
  testWidgets('document settings inline error render proof', (tester) async {
    await tester.runAsync(() async {
      final font = FontLoader('Roboto')
        ..addFont(
          Future.value(
            ByteData.sublistView(
              File('assets/fonts/IBMPlexSansArabic-Regular.ttf')
                  .readAsBytesSync(),
            ),
          ),
        );
      await font.load();
    });
    tester.view.physicalSize = const Size(1100, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await openSettings(tester, superAdmin: true);
    await tester.enterText(
      find.widgetWithText(TextField, 'Maximum discount %'),
      'NaN',
    );
    await tester.tap(find.text('Save settings'));
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      final boundary = tester.binding.renderViews.first.child!;
      // The whole test view is captured through the first repaint boundary.
      RenderRepaintBoundary? found;
      void visit(RenderObject r) {
        if (found != null) return;
        if (r is RenderRepaintBoundary) {
          found = r;
          return;
        }
        r.visitChildren(visit);
      }

      visit(boundary);
      final image = await found!.toImage();
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File('${Directory.systemTemp.path}/document-settings-inline.png')
          .writeAsBytesSync(bytes!.buffer.asUint8List());
    });
  });
}
