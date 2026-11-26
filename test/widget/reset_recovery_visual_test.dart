import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/storage/credentials_store.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/auth/presentation/screens/login_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

/// State after a reset: the installation keeps its administrator and asks for
/// that account's current credentials; once setup is done the normal
/// password-change dialog is reachable from the sign-in screen.
class _ResetApi implements ApiClient {
  final posts = <(String, Object?)>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async => {
    'needsSetup': true,
    'recoveryRequired': false,
    'companyCount': 0,
    'hasUsers': true,
  };

  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async => const [];

  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    posts.add((path, body));
    return {'ok': true};
  }
}

final _key = GlobalKey();

Future<void> _picture(WidgetTester tester, String name) async {
  final boundary = _key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await screenshotFile(name).writeAsBytes(bytes!.buffer.asUint8List());
  });
}

Future<void> _fonts(WidgetTester tester) async {
  await tester.runAsync(() async {
    await (FontLoader('IBMPlexSansArabic')
          ..addFont(Future.value(
            ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync()),
          )))
        .load();
    await (FontLoader('MaterialIcons')
          ..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync()))))
        .load();
  });
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final locale in [const Locale('en'), const Locale('ar')]) {
    testWidgets('reset form asks for current credentials (${locale.languageCode}) and the password dialog opens after recovery', (tester) async {
      tester.view.physicalSize = const Size(1400, 1900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await _fonts(tester);
      final api = _ResetApi();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            tokenStoreProvider.overrideWithValue(FakeTokenStore()),
            authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
            apiClientProvider.overrideWithValue(api),
          ],
          child: RepaintBoundary(
            key: _key,
            child: MaterialApp(
              theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
              locale: locale,
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: LoginScreen(
                credentialsStore: CredentialsStore(canStorePassword: false, deleteSecret: (_) async {}),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final ar = locale.languageCode == 'ar';
      expect(find.textContaining(ar ? 'كلمة السر الحالية' : 'Current password'), findsWidgets);
      expect(find.textContaining('Confirm'), findsNothing);
      await _picture(tester, 'reset-setup-form-${locale.languageCode}.png');

      // Complete recovery with the kept credentials.
      Future<void> type(String label, String value) async {
        final field = find.widgetWithText(TextField, label);
        await tester.ensureVisible(field);
        await tester.enterText(field, value);
      }

      await type('كود الشركة * / Code *', 'CO1');
      await type('اسم الشركة بالعربية * / Name (Arabic) *', 'شركة');
      await type('اسم الشركة بالإنجليزية * / Name (English) *', 'Company');
      await type('اسم المستخدم * / Username *', 'admin');
      await type(ar ? 'كلمة السر الحالية * / Current password *' : 'كلمة السر الحالية * / Current password *', 'Kept-Admin-Password-1');
      await tester.ensureVisible(find.byType(FilledButton).last);
      await tester.tap(find.byType(FilledButton).last);
      await tester.pumpAndSettle();
      expect(api.posts.single.$1, '/setup/initial');
      final sent = api.posts.single.$2! as Map;
      expect(sent['adminUsername'], 'admin');
      expect(sent['adminPassword'], 'Kept-Admin-Password-1');

      // The normal sign-in screen is back, and its password dialog opens.
      expect(find.byType(TextFormField), findsNWidgets(2));
      final changeLabel = AppLocalizations.of(tester.element(find.byType(LoginScreen))).changePassword;
      await tester.tap(find.widgetWithText(TextButton, changeLabel));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      await _picture(tester, 'after-recovery-password-dialog-${locale.languageCode}.png');
    });
  }
}
