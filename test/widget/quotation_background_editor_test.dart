import 'dart:typed_data';

import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/platform/picked_file.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  final posts = <Map<String, dynamic>>[];
  Object? Function(Map<String, dynamic> body)? onBackground;

  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async => const {};

  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async => [];

  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    final map = Map<String, dynamic>.from(body! as Map);
    if (path.endsWith('/quotation-backgrounds')) {
      posts.add(map);
      final out = onBackground?.call(map);
      if (out is Exception) throw out;
      if (out is Error) throw out;
      return (out as Map<String, dynamic>?) ?? {'id': 'bg-1', 'name': map['name']};
    }
    return {'id': 'quotation-id'};
  }
}

Future<void> _open(WidgetTester tester, _Api api, Future<PickedFile?> Function(List<String>) picker) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        itemsProvider.overrideWith((ref) async => []),
        customersProvider.overrideWith((ref) async => []),
        quotationBackgroundPickerProvider.overrideWithValue(picker),
      ],
      child: MaterialApp.router(
        theme: AppTheme.dark(),
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: GoRouter(initialLocation: '/new', routes: [
          GoRoute(path: '/new', builder: (c, s) => QuotationEditorScreen(navigationKey: s.pageKey)),
        ]),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pick(WidgetTester tester) async {
  final b = find.byKey(const ValueKey('quotation-pick-background'));
  await tester.ensureVisible(b);
  await tester.pumpAndSettle();
  await tester.tap(b);
  await tester.pumpAndSettle();
}

PickedFile _file(String name, {int size = 100, String mime = 'image/png'}) =>
    PickedFile(name: name, bytes: Uint8List(size), mimeType: mime);

bool _chip(WidgetTester t, String key) => t.widget<FilterChip>(find.byKey(ValueKey(key))).selected;

void main() {
  testWidgets('picker is offered pdf, png, jpg and jpeg; a PNG uploads and is named', (tester) async {
    final api = _Api();
    List<String>? seen;
    await _open(tester, api, (ext) async {
      seen = ext;
      return _file('letterhead.png');
    });
    await _pick(tester);
    expect(seen, containsAll(['pdf', 'png', 'jpg', 'jpeg']));
    expect(api.posts, hasLength(1));
    expect(api.posts.single.containsKey('page'), isFalse);
    // Keep the bands for now: nothing is hidden silently.
    await tester.tap(find.byKey(const ValueKey('quotation-keep-bands')));
    await tester.pumpAndSettle();
    expect(find.textContaining('letterhead.png'), findsOneWidget);
    expect(_chip(tester, 'quotation-hide-header'), isFalse);
    expect(_chip(tester, 'quotation-hide-footer'), isFalse);
    expect(find.byKey(const ValueKey('quotation-background-bands-hint')), findsOneWidget);
  });

  testWidgets('hiding the program bands is a visible choice that sets both', (tester) async {
    final api = _Api();
    await _open(tester, api, (_) async => _file('l.jpg', mime: 'image/jpeg'));
    await _pick(tester);
    expect(find.text('إخفاء هيدر وفوتر البرنامج؟'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('quotation-hide-bands')));
    await tester.pumpAndSettle();
    expect(_chip(tester, 'quotation-hide-header'), isTrue);
    expect(_chip(tester, 'quotation-hide-footer'), isTrue);
    expect(find.byKey(const ValueKey('quotation-background-bands-hint')), findsNothing);
  });

  testWidgets('multi-page PDF asks for a page, then posts exactly that page', (tester) async {
    final api = _Api()
      ..onBackground = (body) => body.containsKey('page')
          ? {'id': 'bg-2', 'name': body['name']}
          : const ApiFailure('الملف فيه 3 صفحات', statusCode: 400, code: 'BACKGROUND_PAGE_REQUIRED');
    await _open(tester, api, (_) async => _file('multi.pdf', mime: 'application/pdf'));
    await _pick(tester);
    expect(find.text('اختيار صفحة الخلفية'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('quotation-background-page')), '2');
    await tester.tap(find.text('استخدام هذه الصفحة'));
    await tester.pumpAndSettle();
    expect(api.posts, hasLength(2));
    expect(api.posts.last['page'], 2);
    await tester.tap(find.byKey(const ValueKey('quotation-keep-bands')));
    await tester.pumpAndSettle();
    expect(find.textContaining('multi.pdf'), findsOneWidget);
  });

  testWidgets('cancelling the page dialog posts nothing more and sets no background', (tester) async {
    final api = _Api()
      ..onBackground = (_) => const ApiFailure('الملف فيه 3 صفحات', statusCode: 400, code: 'BACKGROUND_PAGE_REQUIRED');
    await _open(tester, api, (_) async => _file('multi.pdf', mime: 'application/pdf'));
    await _pick(tester);
    await tester.tap(find.text('إلغاء'));
    await tester.pumpAndSettle();
    expect(api.posts, hasLength(1));
    expect(find.textContaining('multi.pdf'), findsNothing);
    expect(find.byKey(const ValueKey('quotation-background-stretch')), findsNothing);
  });

  testWidgets('an invalid file shows an error dialog and sets no background', (tester) async {
    final api = _Api()
      ..onBackground = (_) => const ApiFailure('الملف تالف أو ليس PDF أو صورة', statusCode: 400, code: 'BACKGROUND_INVALID');
    await _open(tester, api, (_) async => _file('bad.pdf', mime: 'application/pdf'));
    await _pick(tester);
    expect(find.byType(AlertDialog), findsOneWidget); // the app's error dialog
    expect(find.textContaining('bad.pdf'), findsNothing);
    expect(find.byKey(const ValueKey('quotation-background-stretch')), findsNothing);
  });

  testWidgets('a file over 4 MB is refused before any upload', (tester) async {
    final api = _Api();
    await _open(tester, api, (_) async => _file('big.pdf', size: 4 * 1024 * 1024 + 1, mime: 'application/pdf'));
    await _pick(tester);
    expect(api.posts, isEmpty);
    expect(find.textContaining('4 ميجابايت'), findsWidgets);
    expect(find.textContaining('big.pdf'), findsNothing);
  });

  testWidgets('a file of exactly 4 MB is accepted', (tester) async {
    final api = _Api();
    await _open(tester, api, (_) async => _file('edge.pdf', size: 4 * 1024 * 1024, mime: 'application/pdf'));
    await _pick(tester);
    expect(api.posts, hasLength(1));
  });

  testWidgets('stretch is an explicit chip, off by default', (tester) async {
    final api = _Api();
    await _open(tester, api, (_) async => _file('l.png'));
    await _pick(tester);
    await tester.tap(find.byKey(const ValueKey('quotation-keep-bands')));
    await tester.pumpAndSettle();
    final chip = find.byKey(const ValueKey('quotation-background-stretch'));
    await tester.ensureVisible(chip);
    expect(_chip(tester, 'quotation-background-stretch'), isFalse);
    await tester.tap(chip);
    await tester.pumpAndSettle();
    expect(_chip(tester, 'quotation-background-stretch'), isTrue);
  });
}
