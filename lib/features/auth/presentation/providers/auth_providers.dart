import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/app_config.dart';
import '../../../../core/error/failure.dart';
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

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    ref.watch(appConfigProvider),
    ref.watch(tokenStoreProvider),
  );
  // The network layer clears the dead tokens; this puts the program back on
  // the sign-in screen with a localized explanation instead of leaving every
  // screen failing in a way that looks like a broken installation.
  client.onSessionExpired = () {
    ref.read(authControllerProvider.notifier).sessionExpired();
  };
  return client;
});

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

/// True when the session lives only in this window because the platform
/// refused to store the tokens. The shell says so instead of letting the
/// person discover it when a reload signs them out.
class SessionStorageNotifier extends Notifier<bool> {
  @override
  bool build() => false;

  void update(bool value) => state = value;
}

final volatileSessionProvider =
    NotifierProvider<SessionStorageNotifier, bool>(SessionStorageNotifier.new);

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
    if (result.isSuccess) {
      ref
          .read(volatileSessionProvider.notifier)
          .update(ref.read(tokenStoreProvider).isSessionVolatile);
    }
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

  /// Re-reads whether the signed-in person has a photo.
  ///
  /// Called after a photo is uploaded or removed, so the session object the
  /// whole app watches stops advertising an image that no longer exists (or
  /// starts showing one that now does). Only the two avatar fields change; the
  /// tokens, the tenant and the permissions are untouched - this must never be
  /// a way to silently widen a session.
  Future<void> refreshAvatarState() async {
    final current = state.valueOrNull;
    if (current == null) return;
    try {
      final me = await ref.read(apiClientProvider).get('/auth/me');
      final user = me['user'];
      if (user is! Map) return;
      final hasAvatar = user['hasAvatar'] == true;
      final avatarUrl = user['avatarUrl'];
      state = AsyncValue.data(
        AppUser(
          id: current.id,
          username: current.username,
          fullName: current.fullName,
          companyId: current.companyId,
          branchId: current.branchId,
          roles: current.roles,
          permissions: current.permissions,
          isActive: current.isActive,
          isSuperAdmin: current.isSuperAdmin,
          hasAvatar: hasAvatar,
          avatarUrl: avatarUrl is String ? avatarUrl : null,
        ),
      );
    } on Failure {
      // Not being able to re-read the session must not sign anyone out; the
      // avatar widget falls back to the initial and the next screen refresh
      // corrects it.
    }
  }

  Future<void> signOut() async {
    state = const AsyncValue.loading();
    await ref.read(authRepositoryProvider).signOut();
    ref.read(volatileSessionProvider.notifier).update(false);
    state = const AsyncValue.data(null);
  }

  /// The session was ended by the server: the access token expired and the
  /// refresh token was refused. The network layer has already cleared the
  /// stored tokens; dropping to `null` sends the router to sign-in.
  Future<void> sessionExpired() async {
    if (state.value == null && !state.isLoading) return;
    ref.read(volatileSessionProvider.notifier).update(false);
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
