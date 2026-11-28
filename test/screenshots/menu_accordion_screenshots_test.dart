import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:erp_kayan/features/auth/presentation/widgets/user_photo.dart';
import 'package:erp_kayan/features/settings/presentation/providers/appearance_provider.dart';

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/app_error_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../widget/test_harness.dart';
import 'screenshot_fixtures.dart';

/// Pictures of the main menu, so the accordion is looked at and not only
/// asserted.
///
/// `erp_shell_groups_test.dart` already proves that eight headings exist and
/// that one opens at a time, but a passing assertion cannot show a reviewer
/// what the menu looks like. These render the real [ErpShell] in the states the
/// requirement names - everything closed, one section open, then a second
/// section opened - at the real 1440x900 desktop size.
///
/// The picture is written only when `MENU_SCREENSHOTS=1`, which the screenshot
/// job sets. The assertions below run in every job, so the behaviour is
/// enforced by the ordinary test suite; only the pixel comparison is limited to
/// the job that renders and uploads the images. A golden committed from a
/// machine that has never drawn the frame would be a guess, so the images are
/// produced on the runner and reviewed, not invented here.
class _ShellApi extends ApiClient {
  _ShellApi()
    : super(
        AppConfig.forLocalServer('http://screenshot.invalid/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'blocked': false};

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'blocked': false};
}

Future<void> _loadFonts() async {
  final loader = FontLoader('IBMPlexSansArabic');
  for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    final bytes = await File(
      'assets/fonts/IBMPlexSansArabic-$weight.ttf',
    ).readAsBytes();
    loader.addFont(Future.value(ByteData.sublistView(bytes)));
  }
  await loader.load();

  final roots = <String>{
    ?Platform.environment['FLUTTER_ROOT'],
    for (final part in (Platform.environment['PATH'] ?? '').split(
      Platform.isWindows ? ';' : ':',
    ))
      if (part.isNotEmpty) File(part).parent.path,
  };
  File? icons;
  for (final root in roots) {
    final candidate = File(
      '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    );
    if (candidate.existsSync()) {
      icons = candidate;
      break;
    }
  }
  if (icons != null) {
    final iconLoader = FontLoader('MaterialIcons')
      ..addFont(Future.value(ByteData.sublistView(await icons.readAsBytes())));
    await iconLoader.load();
  }
}

/// The menu itself. Every finder below is scoped to this, because the page
/// header repeats the current section's name - "نظرة عامة" is both a heading in
/// the menu and the eyebrow above the dashboard, and an unscoped `find.text`
/// matches both.
final _menu = find.byKey(const Key('erp-shell-nav-list'));

Finder _inMenu(String label) =>
    find.descendant(of: _menu, matching: find.text(label));

/// The heading of one section, by key.
///
/// Text cannot be used to open a section: "المخزون" is both the inventory
/// heading and the name of an item inside it, so a text finder matches two
/// widgets and the tap is ambiguous.
///
/// Scroll first, then *ensureVisible*. `scrollUntilVisible` stops as soon as
/// its finder matches anything, and the menu is built with a 4000-pixel cache
/// extent so that keyboard users can reach a module without dragging: every
/// heading below the fold is already in the tree. The old helper therefore
/// returned without dragging, `tap` aimed at a widget that was off screen, the
/// hit test found nothing, and the section silently stayed closed — which is
/// what made "opening a second section closes the first" fail while the first
/// section was still open. `ensureVisible` scrolls the heading into the
/// viewport, and the assertion below turns a miss into a named failure instead
/// of a tap that does nothing.
Future<void> _tapGroup(WidgetTester tester, String key) async {
  final heading = find.byKey(ValueKey(key));
  await tester.scrollUntilVisible(
    heading,
    120,
    scrollable: find.descendant(
      of: _menu,
      matching: find.byType(Scrollable),
    ),
  );
  await tester.ensureVisible(heading);
  await tester.pumpAndSettle();
  expect(
    heading.hitTestable(),
    findsOneWidget,
    reason: 'the "$key" heading must be on screen before it is tapped; a tap '
        'on a widget outside the viewport does nothing and hides the bug',
  );
  await tester.tap(heading);
  await tester.pumpAndSettle();
}

/// The eight headings, by the key the shell gives each one.
const _groupKeys = [
  'nav-group-overview',
  'nav-group-accounting',
  'nav-group-parties',
  'nav-group-inventory',
  'nav-group-sales',
  'nav-group-purchases',
  'nav-group-insights',
  'nav-group-administration',
];

final _shellShot=GlobalKey();

Future<void> _pumpShell(WidgetTester tester, {bool dark = false, bool top = false, Uint8List? photo}) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final router = GoRouter(
    initialLocation: AppRoutes.dashboard,
    routes: [
      GoRoute(
        path: AppRoutes.dashboard,
        builder: (context, state) => ErpShell(
          currentPath: AppRoutes.dashboard,
          child: const Text('Dashboard'),
        ),
      ),
    ],
  );
  addTearDown(router.dispose);

  await tester.pumpWidget(
    RepaintBoundary(key:_shellShot,child:ProviderScope(
      overrides: [
        if(photo!=null) userPhotoProvider((companyId:screenshotAdmin.companyId,userId:screenshotAdmin.id)).overrideWith((ref) async => photo),
        appearanceProvider.overrideWith(() => _FixedAppearance(top)),
        tokenStoreProvider.overrideWithValue(FakeTokenStore()),
        authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
        apiClientProvider.overrideWithValue(_ShellApi()),
        currentUserProvider.overrideWithValue(screenshotAdmin),
        // The shell builds the section rail plus its own header and footer; the
        // reviewed screenshots override these too, so the frame under test is
        // the same one they draw.
        chartOfAccountsProvider.overrideWith(
          FakeChartOfAccountsController.new,
        ),
        companyProfileProvider.overrideWith(FakeCompanyProfileController.new),
        branchesProvider.overrideWith(FakeBranchesController.new),
      ],
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: dark ? AppTheme.dark() : AppTheme.light(),
        routerConfig: router,
      ),
    )),
  );
  await tester.pumpAndSettle();
}

/// Captures the frame when the picture job asked for it, and does nothing
/// otherwise, so the ordinary suite enforces the behaviour without needing a
/// committed image it could not have rendered.
Future<void> _shoot(WidgetTester tester, String name) async {
  if (Platform.environment['MENU_SCREENSHOTS'] != '1') return;
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('goldens/$name.png'),
  );
}

class _FixedAppearance extends AppearanceController {
  _FixedAppearance(this.top);final bool top;
  @override Future<Appearance> build() async => Appearance(topNavigation:top);
}

void main() {
  testWidgets('enlarged user avatar dark Arabic desktop visual proof', (tester) async {
    await tester.runAsync(() async => _loadFonts());
    final recorder=ui.PictureRecorder();final canvas=Canvas(recorder);
    canvas.drawRect(const Rect.fromLTWH(0,0,128,128),Paint()..color=const Color(0xFF36789B));
    canvas.drawCircle(const Offset(64,44),24,Paint()..color=const Color(0xFFF2CAA3));
    canvas.drawOval(const Rect.fromLTWH(22,75,84,80),Paint()..color=const Color(0xFF10243A));
    final picture=recorder.endRecording();final data=await tester.runAsync(() async {final image=await picture.toImage(128,128);return image.toByteData(format:ui.ImageByteFormat.png);});
    final topMode=Platform.environment['KAYAN_NAV_MODE']=='top';
    final darkMode=Platform.environment['KAYAN_NAV_THEME']!='light';
    await _pumpShell(tester,dark:darkMode,top:topMode,photo:data!.buffer.asUint8List());
    await tester.runAsync(() async { await precacheImage(MemoryImage(data.buffer.asUint8List()),tester.element(find.byType(ErpShell))); });
    await tester.pumpAndSettle();
    final top=find.byKey(ValueKey('topbar-photo-${screenshotAdmin.id}'));
    final side=find.byKey(ValueKey('sidebar-photo-${screenshotAdmin.id}'));
    expect(tester.widget<CircleAvatar>(top).foregroundImage,isA<MemoryImage>());expect(tester.getSize(top),const Size(52,52));if(!topMode) {expect(tester.getSize(side),const Size(64,64));} else {expect(side,findsNothing);expect(find.byKey(const Key('top-dropdown-navigation')),findsOneWidget);}expect(tester.takeException(),isNull);
    if(topMode && Platform.environment['KAYAN_OPEN_TOP_MENU']=='1') {await tester.tap(find.byKey(const ValueKey('top-nav-sales')));await tester.pumpAndSettle();expect(find.text('فواتير البيع'),findsOneWidget);}
    final path=Platform.environment['KAYAN_AVATAR_SCREENSHOT'];
    if(path!=null) { await tester.runAsync(() async {
      final boundary=_shellShot.currentContext!.findRenderObject()! as RenderRepaintBoundary;final image=await boundary.toImage();final bytes=await image.toByteData(format:ui.ImageByteFormat.png);
      File(path).writeAsBytesSync(bytes!.buffer.asUint8List());
    }); }
  });

  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(_loadFonts);

  testWidgets('the menu shows eight sections and none of their items', (
    tester,
  ) async {
    await _pumpShell(tester);

    for (final key in _groupKeys) {
      expect(
        find.byKey(ValueKey(key)),
        findsOneWidget,
        reason: 'the main menu must show exactly these eight groups; $key is '
            'missing',
      );
    }
    // Nothing is open yet, so no section's items are on screen.
    for (final item in const [
      'المستودعات',
      'الدفعات',
      'فواتير البيع',
      'دليل الحسابات',
    ]) {
      expect(
        _inMenu(item),
        findsNothing,
        reason: '"$item" must stay hidden while its section is closed',
      );
    }

    await _shoot(tester, 'menu_closed_ar');
  });

  testWidgets('opening a section reveals its items', (tester) async {
    await _pumpShell(tester);

    await _tapGroup(tester, 'nav-group-inventory');

    expect(_inMenu('المستودعات'), findsOneWidget);
    expect(_inMenu('الدفعات'), findsOneWidget);

    await _shoot(tester, 'menu_inventory_open_ar');
  });

  testWidgets('opening a second section closes the first', (tester) async {
    await _pumpShell(tester);

    await _tapGroup(tester, 'nav-group-inventory');
    expect(_inMenu('المستودعات'), findsOneWidget);

    await _tapGroup(tester, 'nav-group-sales');

    expect(
      _inMenu('المستودعات'),
      findsNothing,
      reason: 'opening sales must close inventory, or the menu is not an '
          'accordion and grows without bound as sections are visited',
    );
    expect(
      _inMenu('فواتير البيع'),
      findsOneWidget,
      reason: 'the section that was just tapped must open',
    );
    // And the other seven headings are still there. The open sales section is long
    // and the menu has scrolled down to it, so go back to the top first.
    final scrollable = tester.state<ScrollableState>(
      find.descendant(of: _menu, matching: find.byType(Scrollable)).first,
    );
    scrollable.position.jumpTo(0);
    await tester.pumpAndSettle();
    for (final key in _groupKeys) {
      await tester.scrollUntilVisible(
        find.byKey(ValueKey(key)),
        120,
        scrollable: find.descendant(of: _menu, matching: find.byType(Scrollable)).first,
      );
      expect(find.byKey(ValueKey(key)), findsOneWidget);
    }

    await _shoot(tester, 'menu_sales_open_ar');
  });

  testWidgets('inventory and accounting entries sit under short headings, none removed', (tester) async {
    await _pumpShell(tester);

    await _tapGroup(tester, 'nav-group-inventory');
    // A tall window, so the whole open section is built and on screen.
    tester.view.physicalSize = const Size(1440, 2200);
    await tester.pumpAndSettle();
    for (final heading in const [
      'الأصناف والأرصدة',
      'المستودعات والمواقع',
      'حركة المخزون',
      'الصلاحية والتنبيهات والتقارير',
    ]) {
      expect(_inMenu(heading), findsOneWidget, reason: 'inventory heading "$heading"');
    }
    for (final item in const [
      'الأصناف', 'أرصدة المخزون', 'الأرقام التسلسلية والضمان', 'الدفعات',
      'المستودعات', 'مواقع التخزين', 'من يدخل أي مستودع',
      'مستندات المخزون', 'التحويلات المخزنية', 'الجرد', 'إعدام المخزون التالف',
      'تنبيهات انتهاء الصلاحية', 'حدود الأصناف', 'تقارير المخزون',
    ]) {
      expect(_inMenu(item), findsOneWidget, reason: 'inventory entry "$item"');
    }
    // the only "المخزون" left is the section heading itself
    expect(_inMenu('المخزون'), findsOneWidget);

    await _tapGroup(tester, 'nav-group-accounting');
    for (final heading in const [
      'النقدية والشيكات',
      'القيود والفترات',
      'الأصول والتكاليف والموازنات',
      'دليل الحسابات والضرائب',
    ]) {
      expect(_inMenu(heading), findsOneWidget, reason: 'accounting heading "$heading"');
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping the open section closes it again', (tester) async {
    await _pumpShell(tester);

    await _tapGroup(tester, 'nav-group-inventory');
    expect(_inMenu('المستودعات'), findsOneWidget);

    await _tapGroup(tester, 'nav-group-inventory');

    expect(
      _inMenu('المستودعات'),
      findsNothing,
      reason: 'a section must close when its own heading is tapped again',
    );
  });
  testWidgets('a refused scan is shown in the Arabic dialog, not a SnackBar', (
    tester,
  ) async {
    await _pumpShell(tester);

    // The exact call the expiry screen now makes. Before this branch it was
    // ScaffoldMessenger...SnackBar(Text('$error')), which printed the raw
    // failure and slid away on its own.
    unawaited(
      showAppPlainError(
        tester.element(_menu),
        'Scanning is not allowed',
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(AppErrorDialog), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
    expect(find.textContaining('Scanning is not allowed'), findsOneWidget);
    // Right-to-left inside an Arabic app, left-to-right in an English one; the
    // dialog takes the direction of the screen it is opened over.
    expect(
      Directionality.of(tester.element(find.byType(AppErrorDialog))),
      TextDirection.rtl,
    );

    await _shoot(tester, 'error_dialog_ar');
  });

}
