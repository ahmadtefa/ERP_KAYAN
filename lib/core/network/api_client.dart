import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../error/failure.dart';
import '../logging/app_logger.dart';
import '../storage/token_store.dart';

/// Thin, testable wrapper around [Dio].
///
/// Responsibilities:
///  * attach the bearer token to outgoing requests
///  * renew an expired access token once, with a single refresh for every
///    request that noticed the expiry at the same moment
///  * translate transport errors into typed [Failure]s
///  * never log credentials, tokens or financial payloads
///
/// The refresh token rotates on the server: two refreshes racing each other
/// would make one of them look like a stolen token and end the session. That
/// is why [_refreshSession] shares one in-flight future between every caller.
class ApiClient {
  ApiClient(this._config, this._tokenStore, {Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: _config.apiBaseUrl,
              connectTimeout: _config.connectTimeout,
              receiveTimeout: _config.receiveTimeout,
              contentType: Headers.jsonContentType,
              responseType: ResponseType.json,
              // Anything that is not a success is turned into a typed
              // failure below, so a 400 "not enough stock" can never be
              // mistaken for a successful response.
              validateStatus: (status) => status != null && status < 400,
            ),
          ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _tokenStore.readAccessToken();
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onError: (e, handler) async {
          _log.warning('HTTP error: ${e.type} ${e.response?.statusCode}');

          // One renewal and one replay, never a retry loop. The refresh
          // endpoint itself is excluded, and a request that already played
          // this dance is not played again.
          final options = e.requestOptions;
          final isAuthRoute = options.path.startsWith('/auth/');
          final alreadyRetried = options.extra[_retriedKey] == true;
          if (e.response?.statusCode == 401 &&
              !isAuthRoute &&
              !alreadyRetried) {
            final outcome = await _refreshSession();
            final renewed = outcome.accessToken;
            if (renewed != null) {
              try {
                options.headers['Authorization'] = 'Bearer $renewed';
                options.extra[_retriedKey] = true;
                handler.resolve(await _dio.fetch<dynamic>(options));
                return;
              } on DioException catch (retryError) {
                handler.next(retryError);
                return;
              }
            }
            // A refused refresh already ended the session (tokens cleared,
            // app notified). A refresh that merely could not reach the
            // server must not sign anyone out; the original error stands.
          }
          handler.next(e);
        },
      ),
    );
    if (_config.enableLogging) {
      _log.info('ApiClient initialised for ${_config.environment.name}');
    }
  }

  final Dio _dio;
  final TokenStore _tokenStore;
  final AppConfig _config;
  static final _log = AppLogger.of('ApiClient');

  static const _retriedKey = 'kayan.authRetried';

  /// One future shared by every request that hit an expired token at the
  /// same time, so the rotating refresh token is presented exactly once.
  Future<_RefreshOutcome>? _refreshInFlight;

  /// Called once when the server definitively ends the session. The app uses
  /// it to put the sign-in screen back instead of leaving a screen full of
  /// failures that look like a broken program.
  void Function()? onSessionExpired;

  Future<_RefreshOutcome> _refreshSession() {
    final pending = _refreshInFlight;
    if (pending != null) return pending;

    final future = _performRefresh();
    _refreshInFlight = future;
    return future.whenComplete(() {
      if (identical(_refreshInFlight, future)) _refreshInFlight = null;
    });
  }

  Future<_RefreshOutcome> _performRefresh() async {
    final refreshToken = await _tokenStore.readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      return const _RefreshOutcome.invalid();
    }
    try {
      final response = await _dio.post<dynamic>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(extra: const {'kayan.skipAuthRefresh': true}),
      );
      final data = response.data;
      if (data is! Map) return const _RefreshOutcome.unavailable();
      final accessToken = data['accessToken'];
      final rotated = data['refreshToken'];
      if (accessToken is! String || accessToken.isEmpty) {
        return const _RefreshOutcome.unavailable();
      }
      // The server has already issued a fresh, valid session. If the
      // platform refuses to persist it - a browser on plain `http://` does -
      // the token store keeps it in memory, and that must not be reported as
      // a failed renewal, which would send an otherwise working session back
      // to the sign-in screen.
      try {
        await _tokenStore.saveTokens(
          accessToken: accessToken,
          refreshToken: rotated is String && rotated.isNotEmpty
              ? rotated
              : refreshToken,
        );
      } catch (error) {
        _log.warning(
          'The renewed token could not be stored (${error.runtimeType}); '
          'continuing with it in memory',
        );
      }
      _log.info('Access token renewed');
      return _RefreshOutcome.success(accessToken);
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        // The refresh token itself was refused or revoked. That is final:
        // clear the dead session so the app does not keep replaying it, and
        // let the UI return to sign-in with an explanation.
        await _tokenStore.clear();
        onSessionExpired?.call();
        _log.info('Session ended: the refresh token was refused');
        return const _RefreshOutcome.invalid();
      }
      // Offline or a server error: the session may still be perfectly good.
      _log.warning('Could not renew the access token: ${e.type}');
      return const _RefreshOutcome.unavailable();
    } catch (error) {
      _log.warning('Could not renew the access token: $error');
      return const _RefreshOutcome.unavailable();
    }
  }

  Dio get raw => _dio;

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    return _send(() => _dio.get<dynamic>(path, queryParameters: query));
  }

  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    return _send(() => _dio.patch<dynamic>(path, data: body));
  }

  Future<Map<String, dynamic>> put(String path, {Object? body}) async {
    return _send(() => _dio.put<dynamic>(path, data: body));
  }

  /// Deletes a record. Used for the few things that really can be removed —
  /// a role that nobody holds, for instance.
  Future<Map<String, dynamic>> delete(String path) async {
    return _send(() => _dio.delete<dynamic>(path));
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    return _send(
      () => _dio.post<dynamic>(
        path,
        data: body,
        options: Options(
          headers: idempotencyKey == null
              ? null
              : {'Idempotency-Key': idempotencyKey},
        ),
      ),
    );
  }

  /// Reads an endpoint that returns a collection.
  ///
  /// The API answers either with `{ items: [...], total: n }` for paginated
  /// resources or with a bare array for reports, and callers should not have
  /// to care which.
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    final Response<dynamic> response;
    try {
      response = await _dio.get<dynamic>(path, queryParameters: query);
    } on DioException catch (e) {
      throw _mapDioException(e);
    }
    final data = response.data;
    final raw = data is Map && data['items'] is List
        ? data['items'] as List
        : data is List
        ? data
        : const [];
    return raw
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList(growable: false);
  }

  /// Reads an endpoint whose body is an object with several fields.
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    final Response<dynamic> response;
    try {
      response = await _dio.get<dynamic>(path, queryParameters: query);
    } on DioException catch (e) {
      throw _mapDioException(e);
    }
    final data = response.data;
    if (data is Map) return Map<String, dynamic>.from(data);
    return <String, dynamic>{};
  }

  Future<Map<String, dynamic>> _send(
    Future<Response<dynamic>> Function() request,
  ) async {
    try {
      final response = await request();
      final data = response.data;
      if (data is Map<String, dynamic>) return data;
      if (data == null) return <String, dynamic>{};
      return <String, dynamic>{'data': data};
    } on DioException catch (e) {
      throw _mapDioException(e);
    } on Failure {
      rethrow;
    } catch (e) {
      throw ServerFailure('Unexpected client error', e);
    }
  }

  Failure _mapDioException(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.transformTimeout:
      case DioExceptionType.connectionError:
        return const NetworkFailure();
      case DioExceptionType.badCertificate:
        return const NetworkFailure('Server certificate could not be verified');
      case DioExceptionType.cancel:
        return const NetworkFailure('Request cancelled');
      case DioExceptionType.badResponse:
        final status = e.response?.statusCode ?? 0;
        final message =
            _extractMessage(e.response?.data) ??
            'Request failed with status $status';
        if (status == 401) {
          // Sign-in and refresh themselves answer 401 for a wrong password
          // or a dead refresh token; that is not an expired session.
          final path = e.requestOptions.path;
          if (path.endsWith('/auth/login') || path.endsWith('/auth/refresh')) {
            return AuthFailure(message);
          }
          return SessionExpiredFailure(message);
        }
        if (status == 403) {
          return PermissionFailure(message);
        }
        return ApiFailure(message, statusCode: status);
      case DioExceptionType.unknown:
        return const NetworkFailure();
    }
  }

  String? _extractMessage(Object? data) {
    if (data is Map) {
      for (final key in const ['message', 'detail', 'error']) {
        final value = data[key];
        if (value is String && value.trim().isNotEmpty) return value;
      }
    }
    return null;
  }
}


/// What one attempt to renew the access token produced.
///
/// `invalid` is the only outcome that ends the session: the server rejected
/// the refresh token itself. `unavailable` means the server could not be
/// reached, and signing the person out for a dropped connection would be
/// both wrong and infuriating.
class _RefreshOutcome {
  const _RefreshOutcome.success(this.accessToken) : invalid = false;
  const _RefreshOutcome.invalid()
    : accessToken = null,
      invalid = true;
  const _RefreshOutcome.unavailable()
    : accessToken = null,
      invalid = false;

  final String? accessToken;
  final bool invalid;
}
