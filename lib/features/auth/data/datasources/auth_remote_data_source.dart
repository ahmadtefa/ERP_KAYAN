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
    // The token names the session to end. It is sent in the body of a POST -
    // never in the address, which ends up in history and logs - and it is
    // omitted when absent so the API ends every session of the account.
    await _client.post(
      _logout,
      body: refreshToken == null || refreshToken.isEmpty
          ? null
          : {'refreshToken': refreshToken},
    );
  }
}
