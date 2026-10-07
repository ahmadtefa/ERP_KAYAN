import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/result/result.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/domain/repositories/auth_repository.dart';
import 'package:erp_kayan/features/auth/domain/usecases/sign_in_usecase.dart';
import 'package:flutter_test/flutter_test.dart';

const user = AppUser(
  id: 'u1',
  username: 'accountant',
  fullName: 'Test Accountant',
  companyId: 'c1',
);

/// Records how it was called so the tests can assert on delegation.
class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository({this.result = const Success(user)});

  final Result<AppUser> result;
  int signInCalls = 0;
  String? lastUsername;
  String? lastPassword;

  @override
  Future<Result<AppUser>> signIn({
    required String username,
    required String password,
  }) async {
    signInCalls++;
    lastUsername = username;
    lastPassword = password;
    return result;
  }

  @override
  Future<Result<void>> signOut() async => const Success(null);

  @override
  Future<Result<AppUser?>> restoreSession() async => const Success(null);
}

void main() {
  group('SignInUseCase', () {
    test('rejects a blank username without touching the repository', () async {
      final repo = _FakeAuthRepository();
      final result = await SignInUseCase(repo)(username: '  ', password: 'x');

      expect(result.failureOrNull, isA<ValidationFailure>());
      expect(repo.signInCalls, 0);
    });

    test('rejects a blank password without touching the repository', () async {
      final repo = _FakeAuthRepository();
      final result = await SignInUseCase(repo)(username: 'user', password: '');

      expect(result.failureOrNull, isA<ValidationFailure>());
      expect(repo.signInCalls, 0);
    });

    test('trims the username before delegating', () async {
      final repo = _FakeAuthRepository();
      await SignInUseCase(repo)(username: '  accountant  ', password: 'pw');

      expect(repo.signInCalls, 1);
      expect(repo.lastUsername, 'accountant');
    });

    test('passes the password through unchanged', () async {
      final repo = _FakeAuthRepository();
      await SignInUseCase(repo)(username: 'accountant', password: '  pw  ');

      expect(repo.lastPassword, '  pw  ');
    });

    test('propagates a repository failure', () async {
      final repo = _FakeAuthRepository(
        result: const ResultFailure(AuthFailure()),
      );
      final result = await SignInUseCase(repo)(
        username: 'accountant',
        password: 'wrong',
      );

      expect(result.failureOrNull, isA<AuthFailure>());
    });
  });
}
