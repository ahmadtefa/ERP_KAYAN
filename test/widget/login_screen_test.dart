import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/result/result.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/auth/presentation/screens/login_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

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
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tokenStoreProvider.overrideWithValue(tokenStore),
          authRepositoryProvider.overrideWithValue(repository),
          companyBrandingProvider.overrideWith((ref) async => null),
        ],
        child: wrapWithApp(child: const LoginScreen(), locale: locale),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('renders the credential fields and the sign-in action', (
    tester,
  ) async {
    await pumpLogin(tester);

    expect(find.byType(TextFormField), findsNWidgets(2));
    expect(find.text('Username'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Sign In'), findsOneWidget);
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

  testWidgets('remembering saves login details only after successful sign-in', (
    tester,
  ) async {
    await pumpLogin(tester);
    await tester.enterText(find.byType(TextFormField).first, 'accountant');
    await tester.enterText(find.byType(TextFormField).last, 'secret123');
    await tester.tap(find.byType(CheckboxListTile));
    await tester.tap(find.widgetWithText(FilledButton, 'Sign In'));
    await tester.pumpAndSettle();

    expect(tokenStore.rememberLogin, isTrue);
    expect(tokenStore.username, 'accountant');
    expect(tokenStore.password, 'secret123');
  });

  testWidgets('remembered values are restored and cleared when unchecked', (
    tester,
  ) async {
    tokenStore.rememberLogin = true;
    tokenStore.username = 'accountant';
    tokenStore.password = 'secret123';
    await pumpLogin(tester);

    expect(
      tester
          .widget<TextFormField>(find.byType(TextFormField).first)
          .controller
          ?.text,
      'accountant',
    );
    expect(
      tester
          .widget<TextFormField>(find.byType(TextFormField).last)
          .controller
          ?.text,
      'secret123',
    );
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();

    expect(tokenStore.rememberLogin, isFalse);
    expect(tokenStore.username, isNull);
    expect(tokenStore.password, isNull);
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
