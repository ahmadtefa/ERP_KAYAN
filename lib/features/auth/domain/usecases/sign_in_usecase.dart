import '../../../../core/error/failure.dart';
import '../../../../core/result/result.dart';
import '../../../../core/utils/validators.dart';
import '../entities/app_user.dart';
import '../repositories/auth_repository.dart';

/// Validates input locally before delegating to the repository.
///
/// Client-side validation is a UX convenience only; the server must still
/// enforce every rule.
class SignInUseCase {
  const SignInUseCase(this._repository);

  final AuthRepository _repository;

  Future<Result<AppUser>> call({
    required String username,
    required String password,
  }) async {
    if (!Validators.isNotBlank(username)) {
      return const ResultFailure(ValidationFailure('Username is required'));
    }
    if (!Validators.isNotBlank(password)) {
      return const ResultFailure(ValidationFailure('Password is required'));
    }
    return _repository.signIn(username: username.trim(), password: password);
  }
}
