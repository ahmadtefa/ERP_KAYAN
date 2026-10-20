import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:flutter_test/flutter_test.dart';

/// A transport that answers the way the real server does: the access token
/// expires, `/auth/refresh` issues a new pair, and the original request is
/// replayed.
class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter();

  final List<String> paths = [];
  int protectedCalls = 0;

  /// How many protected requests the scripted server answers 401 to. Two when
  /// the test wants two requests to notice the expiry at the same moment.
  int expireFirst = 1;

  /// When true, the refresh endpoint answers 401 - a revoked token.
  bool refuseRefresh = false;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    paths.add(options.path);
    if (options.path == '/auth/refresh') {
      if (refuseRefresh) {
        return ResponseBody.fromString('{}', 401, headers: _json);
      }
      return ResponseBody.fromString(
        '{"accessToken":"access-2","refreshToken":"refresh-2"}',
        200,
        headers: _json,
      );
    }
    protectedCalls += 1;
    if (protectedCalls <= expireFirst) {
      return ResponseBody.fromString(
        '{"message":"expired"}',
        401,
        headers: _json,
      );
    }
    return ResponseBody.fromString('{"ok":true}', 200, headers: _json);
  }

  static const _json = {
    Headers.contentTypeHeader: [Headers.jsonContentType],
  };

  @override
  void close({bool force = false}) {}
}

class _RefusingBackend implements SecureTokenBackend {
  @override
  Future<void> write(String key, String value) async =>
      throw UnsupportedError('FlutterSecureStorageWeb only works in secure contexts');

  @override
  Future<String?> read(String key) async => null;

  @override
  Future<void> delete(String key) async {}
}

ApiClient buildClient(_ScriptedAdapter adapter, TokenStore store) {
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
    store,
    dio: dio,
  );
}

void main() {
  test('an expired token is renewed and the request is replayed', () async {
    final adapter = _ScriptedAdapter();
    final store = TokenStore(backend: _RefusingBackend());
    await store.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-1');
    final client = buildClient(adapter, store);

    final body = await client.get('/anything');

    expect(body['ok'], isTrue);
    expect(adapter.paths, ['/anything', '/auth/refresh', '/anything']);
    // The renewed token is in memory even though the keystore refused it.
    expect(await store.readAccessToken(), 'access-2');
    expect(await store.readRefreshToken(), 'refresh-2');
    expect(store.isSessionVolatile, isTrue);
  });

  test('a refused refresh ends the session once, and only once', () async {
    final adapter = _ScriptedAdapter()..refuseRefresh = true;
    final store = TokenStore(backend: _RefusingBackend());
    await store.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-1');
    final client = buildClient(adapter, store);
    var expired = 0;
    client.onSessionExpired = () => expired += 1;

    // The request was refused because the session really did end, so the
    // typed failure is SessionExpiredFailure, not a network error.
    await expectLater(
      client.get('/anything'),
      throwsA(isA<SessionExpiredFailure>()),
    );

    expect(expired, 1);
    expect(await store.readAccessToken(), isNull);
    expect(adapter.paths.where((p) => p == '/auth/refresh').length, 1);
  });

  test('two requests that expire together share one refresh', () async {
    final adapter = _ScriptedAdapter()..expireFirst = 2;
    final store = TokenStore(backend: _RefusingBackend());
    await store.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-1');
    final client = buildClient(adapter, store);

    final bodies = await Future.wait([client.get('/a'), client.get('/b')]);

    expect(bodies.every((body) => body['ok'] == true), isTrue);
    // The rotating refresh token is presented exactly once; a second
    // presentation would look like a stolen token and end the session.
    expect(adapter.paths.where((p) => p == '/auth/refresh').length, 1);
  });
}
