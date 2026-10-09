import 'package:erp_kayan/core/result/result.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/domain/repositories/auth_repository.dart';
import 'package:flutter/material.dart';

import 'package:erp_kayan/l10n/generated/app_localizations.dart';

/// In-memory stand-in for [TokenStore].
///
/// The real store talks to the platform keystore, which is unavailable in a
/// widget test. Constructing it is safe; only its methods use the channel.
class FakeTokenStore extends TokenStore {
  String? accessToken;
  String? refreshToken;
  String? locale;
  bool rememberLogin = false;

  @override
  Future<String?> readAccessToken() async => accessToken;

  @override
  Future<String?> readRefreshToken() async => refreshToken;

  @override
  Future<void> saveTokens({
    required String accessToken,
    String? refreshToken,
  }) async {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  @override
  Future<void> clear() async {
    accessToken = null;
    refreshToken = null;
  }

  @override
  Future<String?> readLocale() async => locale;

  @override
  Future<void> saveLocale(String languageCode) async => locale = languageCode;

  @override
  Future<bool> rememberLoginEnabled() async => rememberLogin;

  @override
  Future<String?> readRememberedUsername() async =>
      rememberLogin ? username : null;

  @override
  Future<String?> readRememberedPassword() async =>
      rememberLogin ? password : null;

  String? username;
  String? password;

  @override
  Future<void> saveRememberedLogin({
    required String username,
    required String password,
  }) async {
    rememberLogin = true;
    this.username = username;
    this.password = password;
  }

  @override
  Future<void> clearRememberedLogin() async {
    rememberLogin = false;
    username = null;
    password = null;
  }
}

const testUser = AppUser(
  id: 'u1',
  username: 'accountant',
  fullName: 'Test Accountant',
  companyId: 'company-1',
  branchId: 'branch-1',
);

class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository({this.signInResult = const Success(testUser)});

  Result<AppUser> signInResult;

  @override
  Future<Result<AppUser>> signIn({
    required String username,
    required String password,
  }) async => signInResult;

  @override
  Future<Result<void>> signOut() async => const Success(null);

  @override
  Future<Result<AppUser?>> restoreSession() async => const Success(null);
}

/// Wraps a widget with Riverpod, localization delegates and the supplied
/// locale so tests exercise the same translation path as the real app.
Widget wrapWithApp({
  required Widget child,
  Locale locale = const Locale('en'),
}) {
  return MaterialApp(
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: child,
  );
}
