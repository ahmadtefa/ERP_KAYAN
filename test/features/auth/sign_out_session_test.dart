import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:erp_kayan/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:erp_kayan/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:flutter_test/flutter_test.dart';

/// Sign-out has to end the session on the server, and the only thing that
/// names *which* session is the refresh token. If the client clears its
/// storage first and calls `/auth/logout` without it, the server ends every
/// session of the account - including the person's other machines.
class _RecordingAdapter implements HttpClientAdapter {
  _RecordingAdapter();

  final List<String> paths = [];
  final List<Map<String, dynamic>> headers = [];
  int loginStatus = 401;
  int logoutStatus = 204;

  static const _json = {
    Headers.contentTypeHeader: [Headers.jsonContentType],
  };

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    paths.add(options.path);
    headers.add(Map<String, dynamic>.from(options.headers));
    if (options.path == '/auth/login') {
      if (loginStatus != 200) {
        return ResponseBody.fromString(
          '{"status":401,"message":"Invalid username or password"}',
          loginStatus,
          headers: _json,
        );
      }
      return ResponseBody.fromString(
        jsonEncode({
          'accessToken': 'access-1',
          'refreshToken': 'refresh-1',
          'user': {
            'id': 'u1',
            'username': 'cashier',
            'fullName': 'Cashier',
            'companyId': 'c1',
            'roles': <String>[],
            'permissions': <String>[],
          },
        }),
        200,
        headers: _json,
      );
    }
    return ResponseBody.fromString('{}', logoutStatus, headers: _json);
  }

  @override
  void close({bool force = false}) {}
}

class _MemoryBackend implements SecureTokenBackend {
  static _MemoryBackend shared = _MemoryBackend();

  final Map<String, String> values = {};

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> delete(String key) async => values.remove(key);
}

ApiClient _client(_RecordingAdapter adapter) {
  final dio = Dio(
    BaseOptions(
      baseUrl: 'http://127.0.0.1:3000/api/v1',
      validateStatus: (status) => status != null && status < 400,
    ),
  )..httpClientAdapter = adapter;
  return ApiClient(
    const AppConfig(
      environment: AppEnvironment.development,
      apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
      connectTimeout: Duration(seconds: 5),
      receiveTimeout: Duration(seconds: 5),
    ),
    TokenStore(backend: _MemoryBackend.shared),
    dio: dio,
  );
}

void main() {
  setUp(() => _MemoryBackend.shared = _MemoryBackend());

  test('sign-out names the session to end instead of ending all of them', () async {
    final adapter = _RecordingAdapter()..loginStatus = 200;
    final store = TokenStore(backend: _MemoryBackend.shared);
    final client = _client(adapter);
    final repository = AuthRepositoryImpl(AuthRemoteDataSourceImpl(client), store);

    await repository.signIn(username: 'cashier', password: 'correct');
    expect(await store.readRefreshToken(), 'refresh-1');

    await repository.signOut();

    expect(adapter.paths, ['/auth/login', '/auth/logout']);
    expect(adapter.headers.last['x-refresh-token'], 'refresh-1');
    expect(await store.readRefreshToken(), isNull);
    expect(await store.readAccessToken(), isNull);
  });

  test('a refused sign-in stays an invalid-credentials error, not a lost session', () async {
    final adapter = _RecordingAdapter();
    final store = TokenStore(backend: _MemoryBackend.shared);
    final repository = AuthRepositoryImpl(
      AuthRemoteDataSourceImpl(_client(adapter)),
      store,
    );

    final result = await repository.signIn(username: 'cashier', password: 'wrong');

    expect(result.isSuccess, isFalse);
    expect(result.failureOrNull, isA<AuthFailure>());
    expect(result.failureOrNull, isNot(isA<SessionExpiredFailure>()));
    // A refused password must never reach the refresh endpoint, and no
    // credential may be stored because of it.
    expect(adapter.paths, ['/auth/login']);
    expect(await store.readAccessToken(), isNull);
    expect(await store.readRefreshToken(), isNull);
  });
}
