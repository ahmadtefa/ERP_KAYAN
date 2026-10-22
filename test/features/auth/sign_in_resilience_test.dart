import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/result/result.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:erp_kayan/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/screens/login_screen.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/shared/utils/error_messages.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../widget/test_harness.dart';

/// The sign-in path end to end, with the transport faked and the storage real,
/// because the failure that produced "an unexpected error occurred" lived
/// exactly between those two: the server succeeded and the keystore refused.
class _RefusingBackend implements SecureTokenBackend {
  @override
  Future<void> write(String key, String value) async =>
      throw UnsupportedError('FlutterSecureStorageWeb only works in secure contexts');

  @override
  Future<String?> read(String key) async => null;

  @override
  Future<void> delete(String key) async {}
}

class _Remote implements AuthRemoteDataSource {
  _Remote(this.payload);

  final Map<String, dynamic>? payload;

  @override
  Future<Map<String, dynamic>> login({
    required String username,
    required String password,
  }) async {
    final value = payload;
    if (value == null) throw const AuthFailure('Invalid username or password');
    return value;
  }

  @override
  Future<Map<String, dynamic>> currentUser() async => payload ?? const {};

  @override
  Future<void> logout() async {}
}

const _goodPayload = <String, dynamic>{
  'accessToken': 'access-1',
  'refreshToken': 'refresh-1',
  'user': {
    'id': 'u1',
    'username': 'accountant',
    'fullName': 'Test Accountant',
    'companyId': 'company-1',
    'branchId': 'branch-1',
    'roles': ['accountant'],
    'permissions': ['sales.quotations.read'],
  },
};

void main() {
  test('a refused keystore does not turn a good password into a failure', () async {
    final store = TokenStore(backend: _RefusingBackend());
    final repository = AuthRepositoryImpl(_Remote(_goodPayload), store);

    final result = await repository.signIn(
      username: 'accountant',
      password: 'correct',
    );

    expect(result, isA<Success<Object?>>());
    expect(result.valueOrNull?.username, 'accountant');
    expect(result.valueOrNull?.permissions, ['sales.quotations.read']);
    // The session is real, it just will not outlive the page.
    expect(store.isSessionVolatile, isTrue);
    expect(await store.readAccessToken(), 'access-1');
    expect(await store.readRefreshToken(), 'refresh-1');
  });

  test('a refused password is still an invalid-credentials failure', () async {
    final repository = AuthRepositoryImpl(
      _Remote(null),
      TokenStore(backend: _RefusingBackend()),
    );

    final result = await repository.signIn(username: 'a', password: 'wrong');

    expect(result, isA<ResultFailure<Object?>>());
    expect((result as ResultFailure<AppUser>).failure, isA<AuthFailure>());
  });

  test('an answer without the account is incomplete, not a crash', () async {
    final store = TokenStore(backend: _RefusingBackend());
    final repository = AuthRepositoryImpl(
      _Remote(const <String, dynamic>{
        'accessToken': 'access-1',
        'refreshToken': 'refresh-1',
        // A company that was never finished setting up, or a version
        // mismatch: a session is issued but there is no usable account.
        'user': <String, dynamic>{},
      }),
      store,
    );

    final result = await repository.signIn(
      username: 'accountant',
      password: 'correct',
    );

    expect(result, isA<ResultFailure<Object?>>());
    expect((result as ResultFailure<AppUser>).failure, isA<IncompleteSignInFailure>());
    // The half-session is not kept.
    expect(await store.readAccessToken(), isNull);
  });

  testWidgets('that failure reaches the screen as its own sentence', (
    tester,
  ) async {
    final store = TokenStore(backend: _RefusingBackend());
    final repository = AuthRepositoryImpl(_Remote(null), store);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tokenStoreProvider.overrideWithValue(store),
          authRepositoryProvider.overrideWithValue(repository),
        ],
        child: wrapWithApp(child: const LoginScreen()),
      ),
    );
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(LoginScreen));
    final message = localizedError(context, const IncompleteSignInFailure());

    expect(message, contains('did not send the account details'));
    expect(message.toLowerCase(), isNot(contains('unexpected')));
    // The technical cause is never part of the sentence.
    expect(message, isNot(contains('Exception')));
  });
}
