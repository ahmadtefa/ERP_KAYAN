import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../widget/test_harness.dart';

class _ConflictAdapter implements HttpClientAdapter {
  _ConflictAdapter(this.code);
  final String code;
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async =>
    ResponseBody.fromString('{"detail":"Stale order","code":"$code"}', 409,
      headers: {Headers.contentTypeHeader:[Headers.jsonContentType]});
  @override
  void close({bool force = false}) {}
}

void main() {
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
