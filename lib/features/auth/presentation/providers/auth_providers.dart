import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/backend/local_backend.dart';
import '../../../../core/config/app_config.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/result/result.dart';
import '../../../../core/storage/token_store.dart';
import '../../data/datasources/auth_remote_data_source.dart';
import '../../data/repositories/auth_repository_impl.dart';
import '../../domain/entities/app_user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../../domain/usecases/sign_in_usecase.dart';

/// Composition root for the authentication feature.
final appConfigProvider = Provider<AppConfig>((ref) {
  final localBaseUrl = LocalBackend.instance?.baseUrl;
  if (localBaseUrl != null && localBaseUrl.isNotEmpty) {
    return AppConfig.forLocalServer(localBaseUrl);
  }
  return AppConfig.fromEnvironment();
});

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>(
  (ref) =>
      ApiClient(ref.watch(appConfigProvider), ref.watch(tokenStoreProvider)),
);

final authRemoteDataSourceProvider = Provider<AuthRemoteDataSource>(
  (ref) => AuthRemoteDataSourceImpl(ref.watch(apiClientProvider)),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepositoryImpl(
    ref.watch(authRemoteDataSourceProvider),
    ref.watch(tokenStoreProvider),
  ),
);

final signInUseCaseProvider = Provider<SignInUseCase>(
  (ref) => SignInUseCase(ref.watch(authRepositoryProvider)),
);

/// Holds the current session. `null` means "not authenticated".
class AuthController extends AsyncNotifier<AppUser?> {
  @override
  Future<AppUser?> build() async {
    final repository = ref.read(authRepositoryProvider);

    // A session that has run out is renewed silently by the API client. When
    // it cannot be renewed - the refresh token is spent, expired or gone -
    // there is no session left, and the honest thing is to say so rather
    // than leave every screen answering "Invalid or expired token".
    ref.read(apiClientProvider).onSessionExpired = () async {
      await repository.signOut();
      ref.invalidateSelf();
    };

    final result = await repository.restoreSession();
    return result.valueOrNull;
  }

  /// Returns the failure message key on failure, or null on success.
  Future<Result<AppUser>> signIn({
    required String username,
    required String password,
  }) async {
    state = const AsyncValue.loading();
    final result = await ref.read(signInUseCaseProvider)(
      username: username,
      password: password,
    );
    state = AsyncValue.data(result.valueOrNull);
    return result;
  }

  Future<void> signOut() async {
    state = const AsyncValue.loading();
    await ref.read(authRepositoryProvider).signOut();
    state = const AsyncValue.data(null);
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, AppUser?>(
  AuthController.new,
);

/// Convenience selector for the signed-in user, if any.
final currentUserProvider = Provider<AppUser?>(
  (ref) => ref.watch(authControllerProvider).value,
);
