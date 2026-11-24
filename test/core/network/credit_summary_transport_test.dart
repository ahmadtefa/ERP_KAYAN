import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../widget/test_harness.dart';
class _Adapter implements HttpClientAdapter {
  _Adapter(this.summary); final Object? summary;
  @override Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? stream, Future<void>? cancel) async => ResponseBody.fromString(jsonEncode({'detail':'private English sentence','code':'CUSTOMER_CREDIT_LIMIT_EXCEEDED','creditSummary':summary}),409,headers:{Headers.contentTypeHeader:[Headers.jsonContentType]});
  @override void close({bool force=false}) {}
}
void main() {
  test('production-shaped credit409 carries typed summary only when present and valid',() async {
    const valid={'creditLimit':'1000.0000','currentBalance':'800.0000','invoiceAmount':'400.0000','projectedBalance':'1200.0000'};
    for(final summary in [valid,null,{...valid,'creditLimit':'NaN'}]) {
      final dio=Dio(BaseOptions(baseUrl:'http://127.0.0.1:3210/api/v1',validateStatus:(s)=>s!=null&&s<400))..httpClientAdapter=_Adapter(summary);
      final client=ApiClient(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore(),dio:dio);
      try {await client.post('/sales/invoices/i/post');fail('expected credit refusal');}
      on ApiFailure catch(e) {expect(e.creditSummary?.creditLimit,summary==valid?'1000.0000':null);}
    }
  });
}
