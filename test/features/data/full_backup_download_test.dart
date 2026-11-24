import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:erp_kayan/core/platform/download_request.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:flutter_test/flutter_test.dart';

class _Adapter implements HttpClientAdapter {
  Uint8List bytes = Uint8List.fromList([80,71,68,77,80,1,2,255]);
  int status = 200;
  RequestOptions? request;
  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream,
      Future<void>? cancelFuture) async {
    request = options;
    return ResponseBody.fromBytes(bytes, status, headers: {'content-type':['application/octet-stream']});
  }
  @override
  void close({bool force = false}) {}
}
void main() {
  test('download uses API client credentials and exact archive bytes, never browser URL', () async {
    final adapter = _Adapter();
    final dio = Dio(BaseOptions(baseUrl:'http://localhost/api/v1', headers:{'Authorization':'Bearer SYNTHETIC'}))
      ..httpClientAdapter = adapter;
    final bytes = await FullBackupService(dio).downloadBytes('test archive.dump');
    expect(bytes, adapter.bytes);
    expect(adapter.request!.path, '/backup/full/test%20archive.dump/download');
    expect(adapter.request!.headers['Authorization'], 'Bearer SYNTHETIC');
    expect(adapter.request!.responseType, ResponseType.bytes);
    expect(adapter.request!.queryParameters, isEmpty);
  });
  test('HTML masquerading as archive, empty archive and HTTP refusal cannot be saved', () async {
    final adapter = _Adapter();
    final service = FullBackupService(Dio(BaseOptions(baseUrl:'http://localhost/api/v1'))..httpClientAdapter = adapter);
    for (final bytes in [Uint8List(0), Uint8List.fromList('<html>error</html>'.codeUnits)]) {
      adapter.bytes = bytes;
      await expectLater(service.downloadBytes('test.dump'), throwsA(isA<DownloadFailure>()));
    }
    adapter.status = 403;
    await expectLater(service.downloadBytes('test.dump'), throwsA(isA<DioException>()));
  });
}
