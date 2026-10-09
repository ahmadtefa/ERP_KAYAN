import '../../../../core/result/result.dart';
import '../entities/app_user.dart';

/// Contract for authentication, owned by the domain layer.
abstract class AuthRepository {
  /// Authenticates the user and persists the issued tokens on success.
  Future<Result<AppUser>> signIn({
    required String username,
    required String password,
  });

  /// Clears the local session. Remote invalidation is best-effort.
  Future<Result<void>> signOut();

  /// Restores a previously persisted session, if any.
  Future<Result<AppUser?>> restoreSession();
}
