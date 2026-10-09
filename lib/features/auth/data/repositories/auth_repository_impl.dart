import '../../../../core/error/failure.dart';
import '../../../../core/logging/app_logger.dart';
import '../../../../core/result/result.dart';
import '../../../../core/storage/token_store.dart';
import '../../domain/entities/app_user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_remote_data_source.dart';
import '../models/auth_dtos.dart';

class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl(this._remote, this._tokenStore);

  final AuthRemoteDataSource _remote;
  final TokenStore _tokenStore;
  static final _log = AppLogger.of('AuthRepository');

  @override
  Future<Result<AppUser>> signIn({
    required String username,
    required String password,
  }) async {
    try {
      final json = await _remote.login(username: username, password: password);

      final tokens = TokenPairDto.fromJson(json);
      await _tokenStore.saveTokens(
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      );

      // The user object may be nested under `user` or returned flat.
      final userJson = json['user'] is Map<String, dynamic>
          ? json['user'] as Map<String, dynamic>
          : json;

      final user = UserDto(userJson).toDomain();
      _log.info('Sign-in succeeded for user ${user.id}');
      return Success(user);
    } on Failure catch (failure) {
      _log.warning('Sign-in failed: ${failure.runtimeType}');
      return ResultFailure(failure);
    } on FormatException catch (e) {
      await _tokenStore.clear();
      return ResultFailure(ServerFailure('Malformed sign-in response', e));
    } catch (e) {
      _log.severe('Sign-in error', e);
      return ResultFailure(ServerFailure('Sign-in failed', e));
    }
  }

  @override
  Future<Result<AppUser?>> restoreSession() async {
    try {
      final token = await _tokenStore.readAccessToken();
      if (token == null || token.isEmpty) return const Success(null);

      final json = await _remote.currentUser();
      final userJson = json['user'] is Map<String, dynamic>
          ? json['user'] as Map<String, dynamic>
          : json;
      return Success(UserDto(userJson).toDomain());
    } on Failure catch (failure) {
      // An invalid/expired token must not lock the app in a broken state.
      await _tokenStore.clear();
      return ResultFailure(failure);
    } catch (e) {
      await _tokenStore.clear();
      return ResultFailure(ServerFailure('Could not restore session', e));
    }
  }

  @override
  Future<Result<void>> signOut() async {
    try {
      await _remote.logout();
    } catch (_) {
      // Network failure during logout must not prevent local sign-out.
    } finally {
      await _tokenStore.clear();
    }
    return const Success(null);
  }
}
