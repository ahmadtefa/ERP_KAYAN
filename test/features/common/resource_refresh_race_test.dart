import 'dart:async';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../widget/test_harness.dart';

class _ListApi extends ApiClient {
  _ListApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  final pending=<Completer<List<Map<String,dynamic>>>>[];
  bool initial=true;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) {
    if (initial) { initial=false; return Future.value([{'id':'initial'}]); }
    final next=Completer<List<Map<String,dynamic>>>(); pending.add(next); return next.future;
  }
}
class _MutableSourcesApi extends ApiClient {
  _MutableSourcesApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  final rows=<String,List<Map<String,dynamic>>>{};
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => rows[path] ?? [];
}
class _ListController extends JsonListController {
  @override
  String get resourcePath => '/synthetic';
}
final _provider=AsyncNotifierProvider<JsonListController,List<Map<String,dynamic>>>(_ListController.new);

void main() {
  test('active pickers rebuild from each invalidated source', () async {
    final api=_MutableSourcesApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api)]);
    addTearDown(container.dispose);
    for (final entry in [
      (path:'/inventory/items',source:itemsProvider,active:activeItemsProvider),
      (path:'/parties/customers',source:customersProvider,active:activeCustomersProvider),
      (path:'/parties/suppliers',source:suppliersProvider,active:activeSuppliersProvider),
    ]) {
      api.rows[entry.path]=[{'id':'old','isActive':true}];
      final sub=container.listen(entry.active,(_,_) {});
      expect((await container.read(entry.active.future)).single['id'],'old');
      api.rows[entry.path]=[{'id':'old','isActive':false},{'id':'new','isActive':true}];
      container.invalidate(entry.source);
      await container.read(entry.source.future);
      await container.pump();
      expect((await container.read(entry.active.future)).map((row) => row['id']).toList(),['new']);
      sub.close();
    }
  });
  test('overlapping refreshes keep the latest result, not the last response', () async {
    final api=_ListApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api)]);
    addTearDown(container.dispose);
    final sub=container.listen(_provider,(_,_) {});
    addTearDown(sub.close);
    expect((await container.read(_provider.future)).single['id'],'initial');
    final controller=container.read(_provider.notifier);
    final older=controller.reload();
    final newer=controller.refreshQuietly();
    api.pending[1].complete([{'id':'newer'}]);
    await newer;
    expect(container.read(_provider).requireValue.single['id'],'newer');
    api.pending[0].complete([{'id':'stale'}]);
    await older;
    expect(container.read(_provider).requireValue.single['id'],'newer');
  });
  test('a stale failure does not overwrite a newer successful refresh', () async {
    final api=_ListApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api)]);
    addTearDown(container.dispose);
    final sub=container.listen(_provider,(_,_) {});
    addTearDown(sub.close);
    await container.read(_provider.future);
    final controller=container.read(_provider.notifier);
    final older=controller.refreshQuietly();
    final newer=controller.reload();
    api.pending[1].complete([{'id':'current'}]); await newer;
    api.pending[0].completeError(StateError('old request failed')); await older;
    expect(container.read(_provider).requireValue.single['id'],'current');
  });
}
