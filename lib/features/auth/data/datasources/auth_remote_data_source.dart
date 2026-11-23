import '../../../../core/network/api_client.dart';

/// Raw transport access for authentication endpoints.
abstract class AuthRemoteDataSource {
  Future<Map<String, dynamic>> login({
    required String username,
    required String password,
  });

  Future<Map<String, dynamic>> currentUser();

  /// Ends the session. With the refresh token the server revokes exactly that
  /// session and the person's other devices stay signed in; without it the
  /// request identifies no particular session, so the server ends all of the
  /// account's live sessions.
  Future<void> logout({String? refreshToken});
}

class AuthRemoteDataSourceImpl implements AuthRemoteDataSource {
  const AuthRemoteDataSourceImpl(this._client);

  final ApiClient _client;

  static const _login = '/auth/login';
  static const _me = '/auth/me';
  static const _logout = '/auth/logout';

  @override
  Future<Map<String, dynamic>> login({
    required String username,
    required String password,
  }) {
    return _client.post(
      _login,
      body: {'username': username, 'password': password},
    );
  }

  @override
  Future<Map<String, dynamic>> currentUser() => _client.get(_me);

  @override
  Future<void> logout({String? refreshToken}) async {
    // The header is how the API names the session to end. It carries a
    // credential, so it is sent as a header and never as a query parameter.
    await _client.post(
      _logout,
      headers: refreshToken == null || refreshToken.isEmpty
          ? null
          : {'x-refresh-token': refreshToken},
    );
  }
}
