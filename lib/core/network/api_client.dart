import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../error/failure.dart';
import '../logging/app_logger.dart';
import '../storage/token_store.dart';

/// Thin, testable wrapper around [Dio].
///
/// Responsibilities:
///  * attach the bearer token to outgoing requests
///  * translate transport errors into typed [Failure]s
///  * never log credentials, tokens or financial payloads
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
        onError: (e, handler) {
          _log.warning('HTTP error: ${e.type} ${e.response?.statusCode}');
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
        if (status == 401 || status == 403) {
          return AuthFailure(message);
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
