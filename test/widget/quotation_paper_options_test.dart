import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/router/draft_exit_guard.dart';
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
    ..addFont(Future.value(ByteData.sublistView(File('/tmp/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf').readAsBytesSync())));
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
      Directory('/tmp/shots').createSync(recursive: true);
      File('/tmp/shots/quotation-paper-options.png').writeAsBytesSync(data!.buffer.asUint8List());
    });
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
