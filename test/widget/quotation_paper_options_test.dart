import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

/// The Material icon font ships inside the Flutter SDK; find it from the SDK
/// the test runs under instead of a fixed path. Missing font only means icon
/// glyphs render as boxes in a proof image, never a failed test.
ByteData _materialIcons() {
  final roots = <String>[];
  final env = Platform.environment['FLUTTER_ROOT'];
  if (env != null) roots.add(env);
  for (var d = File(Platform.resolvedExecutable).parent; d.path != d.parent.path; d = d.parent) {
    roots.add(d.path);
  }
  for (final root in roots) {
    final f = File('$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
    if (f.existsSync()) return ByteData.sublistView(f.readAsBytesSync());
  }
  return ByteData(0);
}

/// Where proof images go: KAYAN_SHOT_DIR, else a temp folder that always exists.
File _shot(String name) {
  final dir = Directory(Platform.environment['KAYAN_SHOT_DIR'] ?? '${Directory.systemTemp.path}/kayan-shots')..createSync(recursive: true);
  return File('${dir.path}/$name');
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  String? postPath;
  Map<String, dynamic>? postBody;
  Map<String, dynamic>? objectResponse;
  Completer<Map<String, dynamic>>? pendingPost;

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => objectResponse ?? const {};

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    postPath = path;
    postBody = Map<String, dynamic>.from(body! as Map);
    return pendingPost == null ? {'id': 'quotation-id'} : await pendingPost!.future;
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];
}


Future<void> _loadFonts() async {
  final loader = FontLoader('IBMPlexSansArabic');
  for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    final bytes = await File('assets/fonts/IBMPlexSansArabic-$weight.ttf').readAsBytes();
    loader.addFont(Future.value(ByteData.sublistView(bytes)));
  }
  await loader.load();
  final icons = FontLoader('MaterialIcons')
    ..addFont(Future.value(_materialIcons()));
  await icons.load();
}

void main() {
  testWidgets('paper options sit in the design card and toggle', (tester) async {
    await tester.runAsync(_loadFonts);
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final key = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: key,
        child: ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(_FakeApiClient()),
            itemsProvider.overrideWith((ref) async => []),
            customersProvider.overrideWith((ref) async => []),
          ],
          child: MaterialApp.router(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.dark(),
            locale: const Locale('ar'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: GoRouter(initialLocation: '/new', routes: [
              GoRoute(path: '/new', builder: (c, s) => QuotationEditorScreen(navigationKey: s.pageKey)),
            ]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final header = find.byKey(const ValueKey('quotation-hide-header'));
    await tester.ensureVisible(header);
    await tester.pumpAndSettle();
    await tester.tap(header);
    await tester.pumpAndSettle();
    expect(tester.widget<FilterChip>(header).selected, isTrue);
    await tester.runAsync(() async {
      final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage();
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      _shot('quotation-paper-options.png').writeAsBytesSync(data!.buffer.asUint8List());
    });
  });

  testWidgets('reopened quotation restores chosen background and paper switches', (tester) async {
    final api=_FakeApiClient()..objectResponse={
      'id':'quotation-id','quotationDate':'2026-11-24','currency':'EGP','customer':{'id':'c'},
      'design':{'backgroundId':'11111111-1111-4111-8111-111111111111','backgroundName':'saved-letterhead.pdf','hideHeader':true,'hideFooter':true},
      'tables':[{'title':'Test','lines':[{'description':'Service','quantity':'1','unitPrice':'100'}]}],
    };
    tester.view.physicalSize=const Size(1400,900);tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(ProviderScope(overrides:[
      apiClientProvider.overrideWithValue(api),itemsProvider.overrideWith((ref)async=>[]),customersProvider.overrideWith((ref)async=>[{'id':'c','nameEn':'Customer'}]),
    ],child:MaterialApp.router(localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
      routerConfig:GoRouter(initialLocation:'/edit',routes:[GoRoute(path:'/edit',builder:(c,s)=>QuotationEditorScreen(quotationId:'quotation-id',navigationKey:s.pageKey))]))));
    await tester.pumpAndSettle();
    final header=find.byKey(const ValueKey('quotation-hide-header'));await tester.ensureVisible(header);await tester.pumpAndSettle();
    expect(tester.widget<FilterChip>(header).selected,isTrue);
    expect(tester.widget<FilterChip>(find.byKey(const ValueKey('quotation-hide-footer'))).selected,isTrue);
    expect(find.textContaining('saved-letterhead.pdf'),findsOneWidget);
  });

  testWidgets('saving without a customer marks the customer field and keeps input', (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_FakeApiClient()),
          itemsProvider.overrideWith((ref) async => []),
          customersProvider.overrideWith((ref) async => []),
        ],
        child: MaterialApp.router(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: GoRouter(initialLocation: '/new', routes: [
            GoRoute(path: '/new', builder: (c, s) => QuotationEditorScreen(navigationKey: s.pageKey)),
          ]),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('quotation-subject')), 'Keep me');
    await tester.tap(find.text('Save'));
    await tester.pump();
    expect(find.text('Select a customer'), findsWidgets);
    expect(find.text('Keep me'), findsOneWidget);
    await tester.pumpAndSettle(const Duration(seconds: 5));
  });
}
