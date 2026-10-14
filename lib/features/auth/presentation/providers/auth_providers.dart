import 'package:flutter_riverpod/flutter_riverpod.dart';

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
final appConfigProvider = Provider<AppConfig>(
  (ref) => AppConfig.fromEnvironment(),
);

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>(
  (ref) =>
      ApiClient(ref.watch(appConfigProvider), ref.watch(tokenStoreProvider)),
);

final companyBrandingProvider = FutureProvider<Map<String, dynamic>?>((
  ref,
) async {
  try {
    final user = ref.watch(currentUserProvider);
    return await ref
        .watch(apiClientProvider)
        .get(user == null ? '/companies/branding' : '/companies/my-branding');
  } catch (_) {
    return null;
  }
});

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
    final result = await repository.restoreSession();
    return result.valueOrNull;
  }

  /// Returns the failure message key on failure, or null on success.
  Future<Result<AppUser>> signIn({
    required String username,
    required String password,
    bool rememberLogin = false,
  }) async {
    state = const AsyncValue.loading();
    final result = await ref.read(signInUseCaseProvider)(
      username: username,
      password: password,
    );
    if (result.isSuccess && rememberLogin) {
      try {
        await ref
            .read(tokenStoreProvider)
            .saveRememberedLogin(username: username.trim(), password: password);
      } catch (_) {
        // Remembering is optional; secure-storage failure must not block login.
      }
    }
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
