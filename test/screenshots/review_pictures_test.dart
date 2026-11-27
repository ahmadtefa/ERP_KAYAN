import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/parties/presentation/customer_terms.dart';
import 'package:erp_kayan/features/settings/presentation/providers/appearance_provider.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/form_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../widget/test_harness.dart';
import 'screenshot_fixtures.dart';

/// Review pictures (synthetic data, no backend): the main menu with each
/// section open, and the customer payment-period dropdown, in Arabic and
/// English. They assert almost nothing; CI uploads them from
/// KAYAN_VISUAL_OUTPUT so a person can look at them.
class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://screenshot.invalid/api/v1'), FakeTokenStore());
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async => {'blocked': false};
  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async => {'blocked': false};
}

class _Appearance extends AppearanceController {
  @override
  Future<Appearance> build() async => const Appearance(topNavigation: false);
}

Future<void> _fonts(WidgetTester tester) async {
  await tester.runAsync(() async {
    final loader = FontLoader('IBMPlexSansArabic');
    for (final w in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      loader.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-$w.ttf').readAsBytesSync())));
    }
    await loader.load();
    await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();
  });
}

Future<void> _shoot(WidgetTester tester, GlobalKey key, String name) async {
  final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await screenshotFile('$name.png').writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

const _groups = [
  'overview', 'accounting', 'parties', 'inventory', 'sales', 'purchases', 'insights', 'administration',
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final arabic in [true, false]) {
    final lang = arabic ? 'ar' : 'en';
    for (final group in _groups) {
      testWidgets('menu picture: $group open ($lang)', (tester) async {
        await _fonts(tester);
        tester.view.physicalSize = const Size(1440, 1500);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final key = GlobalKey();
        final router = GoRouter(
          initialLocation: AppRoutes.dashboard,
          routes: [
            GoRoute(
              path: AppRoutes.dashboard,
              builder: (c, s) => ErpShell(currentPath: AppRoutes.dashboard, child: const Text('Dashboard')),
            ),
          ],
        );
        addTearDown(router.dispose);
        await tester.pumpWidget(RepaintBoundary(
          key: key,
          child: ProviderScope(
            overrides: [
              appearanceProvider.overrideWith(_Appearance.new),
              tokenStoreProvider.overrideWithValue(FakeTokenStore()),
              authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
              apiClientProvider.overrideWithValue(_Api()),
              currentUserProvider.overrideWithValue(screenshotAdmin),
              chartOfAccountsProvider.overrideWith(FakeChartOfAccountsController.new),
              companyProfileProvider.overrideWith(FakeCompanyProfileController.new),
              branchesProvider.overrideWith(FakeBranchesController.new),
            ],
            child: MaterialApp.router(
              debugShowCheckedModeBanner: false,
              locale: Locale(lang),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              theme: AppTheme.light(),
              routerConfig: router,
            ),
          ),
        ));
        await tester.pumpAndSettle();
        final heading = find.byKey(ValueKey('nav-group-$group'));
        await tester.ensureVisible(heading);
        await tester.pumpAndSettle();
        await tester.tap(heading);
        await tester.pumpAndSettle();
        await _shoot(tester, key, 'menu-$group-$lang');
      });
    }

    testWidgets('credit-period dropdown picture ($lang)', (tester) async {
      await _fonts(tester);
      tester.view.physicalSize = const Size(1000, 1100);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(
        key: key,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          locale: Locale(lang),
          theme: AppTheme.light(),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Builder(
              builder: (context) => Center(
                child: FilledButton(
                  onPressed: () => showFormSheet(
                    context,
                    title: arabic ? 'عميل جديد' : 'New customer',
                    fields: [
                      FieldSpec('name', arabic ? 'الاسم' : 'Name'),
                      FieldSpec('creditLimit', arabic ? 'حد الائتمان' : 'Credit limit', kind: FieldKind.decimal),
                      ...customerTermFields(isArabic: arabic),
                    ],
                    initial: termInitialFrom(null),
                    onSubmit: (values) async {},
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await _shoot(tester, key, 'customer-form-$lang');
      await tester.tap(find.text(termMethodLabel('FROM_INVOICE_DATE', isArabic: arabic)));
      await tester.pumpAndSettle();
      await _shoot(tester, key, 'customer-credit-dropdown-$lang');
      expect(tester.takeException(), isNull);
    });
  }
}
