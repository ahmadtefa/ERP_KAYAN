import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../widget/test_harness.dart';

class _CountingAdapter implements HttpClientAdapter {
  final Map<String, int> calls = {};
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final key = '${options.method} ${options.path}';
    calls[key] = (calls[key] ?? 0) + 1;
    return ResponseBody.fromString(
      options.method == 'GET' ? '[{"id":"1","code":"A${calls[key]}"}]' : '{"ok":true}',
      200,
      headers: {Headers.contentTypeHeader: [Headers.jsonContentType]},
    );
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _client(_CountingAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: 'http://127.0.0.1:3210/api/v1'))..httpClientAdapter = adapter;
  return ApiClient(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore(), dio: dio);
}

void main() {
  test('a reference list is fetched once inside the minute and the callers get separate copies', () async {
    final adapter = _CountingAdapter();
    final api = _client(adapter);
    final first = await api.getList('/company/branches');
    first.first['code'] = 'changed-by-caller';
    final second = await api.getList('/company/branches');
    expect(adapter.calls['GET /company/branches'], 1);
    expect(second.first['code'], 'A1');
  });

  test('any write empties the cache, so the next read goes to the server', () async {
    final adapter = _CountingAdapter();
    final api = _client(adapter);
    await api.getList('/inventory/warehouses');
    await api.post('/inventory/warehouses', body: {'code': 'W'});
    final after = await api.getList('/inventory/warehouses');
    expect(adapter.calls['GET /inventory/warehouses'], 2);
    expect(after.first['code'], 'A2');
  });

  test('lists that hold money or stock are never cached', () async {
    final adapter = _CountingAdapter();
    final api = _client(adapter);
    await api.getList('/cash/balances');
    await api.getList('/cash/balances');
    await api.getList('/inventory/stock');
    await api.getList('/inventory/stock');
    expect(adapter.calls['GET /cash/balances'], 2);
    expect(adapter.calls['GET /inventory/stock'], 2);
  });
}
