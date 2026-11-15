import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../widget/test_harness.dart';

class _ConflictAdapter implements HttpClientAdapter {
  _ConflictAdapter(this.code, {this.status = 409});
  final String code;
  final int status;
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async =>
    ResponseBody.fromString('{"detail":"synthetic-private-marker","code":"$code"}', status,
      headers: {Headers.contentTypeHeader:[Headers.jsonContentType]});
  @override
  void close({bool force = false}) {}
}

void main() {
  test('licence mismatch retains its code; other 403s remain permission failures', () async {
    for (final code in ['LICENSE_STATE_ID_MISMATCH', 'OTHER_PERMISSION']) {
      final dio = Dio(BaseOptions(baseUrl:'http://127.0.0.1:3210/api/v1',
        validateStatus:(status) => status != null && status < 400))
        ..httpClientAdapter = _ConflictAdapter(code, status:403);
      final client = ApiClient(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore(), dio:dio);
      await expectLater(client.put('/sales/orders/order', body:{}), throwsA(
        code == 'LICENSE_STATE_ID_MISMATCH'
          ? isA<ApiFailure>().having((failure) => failure.code, 'code', code)
          : isA<PermissionFailure>()));
    }
  });

  test('only a validated problem code is exposed on ApiFailure', () async {
    for (final code in ['ORDER_EDIT_STALE', 'not safe']) {
      final dio = Dio(BaseOptions(baseUrl:'http://127.0.0.1:3210/api/v1',
        validateStatus:(status) => status != null && status < 400))..httpClientAdapter = _ConflictAdapter(code);
      final client = ApiClient(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore(), dio:dio);
      await expectLater(client.put('/sales/orders/order', body:{}), throwsA(isA<ApiFailure>()
        .having((failure) => failure.statusCode, 'status', 409)
        .having((failure) => failure.code, 'code', code == 'ORDER_EDIT_STALE' ? code : null)));
    }
  });
}
