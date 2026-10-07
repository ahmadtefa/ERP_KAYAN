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
  ApiClient(
    this._config,
    this._tokenStore, {
    Dio? dio,
  })  : _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: _config.apiBaseUrl,
                connectTimeout: _config.connectTimeout,
                receiveTimeout: _config.receiveTimeout,
                contentType: Headers.jsonContentType,
                responseType: ResponseType.json,
                // Let the client handle non-2xx explicitly so we can map
                // status codes to typed failures.
                validateStatus: (status) => status != null && status < 500,
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
        final message = _extractMessage(e.response?.data) ??
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
