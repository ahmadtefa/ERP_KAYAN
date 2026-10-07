import '../../../../core/network/api_client.dart';

/// Raw transport access for authentication endpoints.
abstract class AuthRemoteDataSource {
  Future<Map<String, dynamic>> login({
    required String username,
    required String password,
  });

  Future<Map<String, dynamic>> currentUser();

  Future<void> logout();
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
    return _client.post(_login, body: {
      'username': username,
      'password': password,
    });
  }

  @override
  Future<Map<String, dynamic>> currentUser() => _client.get(_me);

  @override
  Future<void> logout() async {
    await _client.post(_logout);
  }
}
