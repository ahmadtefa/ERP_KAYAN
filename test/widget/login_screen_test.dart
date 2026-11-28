import 'package:erp_kayan/core/backend/setup_state.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/result/result.dart';
import 'package:erp_kayan/core/storage/credentials_store.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/auth/presentation/screens/login_screen.dart';
import 'package:erp_kayan/shared/widgets/searchable_select_field.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

class _RecoverySetupApi implements ApiClient {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'needsSetup': false, 'recoveryRequired': true};
}

class _CompanyOptionsApi implements ApiClient {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => const [];
}

class _PasswordChangeApi implements ApiClient {
  final posts = <(String, Object?)>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'needsSetup': false, 'recoveryRequired': false};

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [
    {'code': 'ACME', 'nameEn': 'Acme', 'nameAr': 'أكمي'},
  ];

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add((path, body));
    return {'changed': true};
  }
}

void main() {
  late FakeTokenStore tokenStore;
  late FakeAuthRepository repository;

  setUp(() {
    tokenStore = FakeTokenStore();
    repository = FakeAuthRepository();
  });

  Future<void> pumpLogin(
    WidgetTester tester, {
    Locale locale = const Locale('en'),
    ApiClient? apiClient,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tokenStoreProvider.overrideWithValue(tokenStore),
          authRepositoryProvider.overrideWithValue(repository),
          if (apiClient != null) apiClientProvider.overrideWithValue(apiClient),
        ],
        child: wrapWithApp(
          child: LoginScreen(credentialsStore: CredentialsStore(
            canStorePassword: false,
            deleteSecret: (_) async {},
          )),
          locale: locale,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  for (final locale in [const Locale('ar'), const Locale('en')]) {
    testWidgets('existing company or orphaned users show recovery in ${locale.languageCode}', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            tokenStoreProvider.overrideWithValue(tokenStore),
            authRepositoryProvider.overrideWithValue(repository),
            apiClientProvider.overrideWithValue(_RecoverySetupApi()),
          ],
          child: wrapWithApp(child: const LoginScreen(), locale: locale),
        ),
      );
      await tester.pumpAndSettle();
      final message = locale.languageCode == 'ar'
          ? setupRecoveryMessageAr : setupRecoveryMessageEn;
      expect(find.text(message), findsOneWidget);
      expect(find.byType(TextFormField), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
      if (locale.languageCode == 'ar') {
        expect(Directionality.of(tester.element(find.text(message))), TextDirection.rtl);
      }
    });
  }

  testWidgets('renders the credential fields and the sign-in action', (
    tester,
  ) async {
    await pumpLogin(tester);

    expect(find.byType(TextFormField), findsNWidgets(3));
    expect(find.text('Username'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Sign In'), findsOneWidget);
    // The product emblem sits above the sign-in form.
    expect(find.byKey(const ValueKey('login-brand-emblem')), findsOneWidget);
  });

  testWidgets('offers pre-login password change and its bilingual secure fields', (
    tester,
  ) async {
    await pumpLogin(tester, apiClient: _CompanyOptionsApi());

    await tester.tap(find.widgetWithText(TextButton, 'Change password'));
    await tester.pumpAndSettle();
    expect(find.text('Current password'), findsOneWidget);
    expect(find.text('New password'), findsOneWidget);
    expect(find.text('Confirm new password'), findsOneWidget);
    // The username alone finds the company: no company chooser and no
    // company code field. The login form stays mounted behind the dialog.
    expect(find.byType(SearchableSelectField), findsNothing);
    expect(find.text('Company'), findsNothing);
    expect(find.byType(TextField), findsNWidgets(6));
    expect(find.byIcon(Icons.visibility_outlined), findsNWidgets(4));
  });

  testWidgets('changes a password before login and clears the old session', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    tokenStore.accessToken = 'expired-access';
    tokenStore.refreshToken = 'expired-refresh';
    final api = _PasswordChangeApi();
    await pumpLogin(tester, apiClient: api);

    await tester.enterText(find.byType(TextFormField).first, 'sara');
    await tester.tap(find.widgetWithText(TextButton, 'Change password'));
    await tester.pumpAndSettle();
    expect(find.text('Acme · ACME'), findsNothing);

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(3), 'CurrentPassword!123');
    await tester.enterText(fields.at(4), 'NewPassword!12345');
    await tester.enterText(fields.at(5), 'NewPassword!12345');
    await tester.tap(find.widgetWithText(FilledButton, 'Change password'));
    await tester.pumpAndSettle();

    expect(api.posts, hasLength(1));
    expect(api.posts.single.$1, '/auth/change-password');
    expect(api.posts.single.$2, {
      'username': 'sara',
      'currentPassword': 'CurrentPassword!123',
      'newPassword': 'NewPassword!12345',
      'confirmPassword': 'NewPassword!12345',
    });
    expect(tokenStore.accessToken, isNull);
    expect(tokenStore.refreshToken, isNull);
    expect(
      find.text('Password changed, and the old sessions were ended.'),
      findsOneWidget,
    );
  });

  testWidgets('blocks submission and reports both empty fields', (
    tester,
  ) async {
    await pumpLogin(tester);

    await tester.tap(find.widgetWithText(FilledButton, 'Sign In'));
    await tester.pumpAndSettle();

    expect(find.text('Username is required'), findsOneWidget);
    expect(find.text('Password is required'), findsOneWidget);
    // No API call may be attempted with invalid input.
    expect(tokenStore.accessToken, isNull);
  });

  testWidgets('a valid form sends the credentials and shows the API error', (
    tester,
  ) async {
    repository.signInResult = const ResultFailure(AuthFailure());
    await pumpLogin(tester);

    await tester.enterText(find.byType(TextFormField).first, 'accountant');
    await tester.enterText(find.byType(TextFormField).last, 'secret123');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign In'));
    await tester.pumpAndSettle();

    expect(find.text('Invalid username or password'), findsOneWidget);
  });

  testWidgets('a network failure is reported with its own message', (
    tester,
  ) async {
    repository.signInResult = const ResultFailure(NetworkFailure());
    await pumpLogin(tester);

    await tester.enterText(find.byType(TextFormField).first, 'accountant');
    await tester.enterText(find.byType(TextFormField).last, 'secret123');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign In'));
    await tester.pumpAndSettle();

    expect(
      find.text(
        'Cannot reach the server. Check your connection or the API address.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('the password is obscured until the toggle is pressed', (
    tester,
  ) async {
    await pumpLogin(tester);

    TextField field() => tester.widget<TextField>(find.byType(TextField).last);
    expect(field().obscureText, isTrue);

    await tester.tap(find.byIcon(Icons.visibility_outlined));
    await tester.pumpAndSettle();

    expect(field().obscureText, isFalse);
  });

  testWidgets('renders in Arabic and lays the form out right-to-left', (
    tester,
  ) async {
    await pumpLogin(tester, locale: const Locale('ar'));

    expect(find.text('تسجيل الدخول'), findsWidgets);
    expect(find.text('اسم المستخدم'), findsOneWidget);

    final form = tester.widget<Form>(find.byType(Form));
    final direction = Directionality.of(tester.element(find.byWidget(form)));
    expect(direction, TextDirection.rtl);
  });
}
