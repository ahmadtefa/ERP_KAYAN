import 'dart:async';

import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../widget/test_harness.dart';

class _DeferredChartApi extends ApiClient {
  _DeferredChartApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  final pending=<Completer<Map<String,dynamic>>>[];
  @override
  Future<Map<String,dynamic>> get(String path,{Map<String,dynamic>? query}) {
    final request=Completer<Map<String,dynamic>>(); pending.add(request); return request.future;
  }
}
Map<String,dynamic> _page(String id) => {'items':[{'id':id,'code':id,'name':id,'type':'asset'}]};

class _MutableChartApi extends ApiClient {
  _MutableChartApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  bool active=true;
  @override
  Future<Map<String,dynamic>> get(String path,{Map<String,dynamic>? query}) async =>
    {'items':[{'id':'account','code':'1','name':'Account','type':'asset','isActive':active}]};
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    active=false;
    throw const NetworkFailure();
  }
}

void main() {
  test('chart initial load follows a newer refresh', () async {
    final api=_DeferredChartApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'))]);
    addTearDown(container.dispose);
    final sub=container.listen(chartOfAccountsProvider,(_,_) {}); addTearDown(sub.close);
    final controller=container.read(chartOfAccountsProvider.notifier);
    final refresh=controller.refresh();
    api.pending[1].complete(_page('new')); await refresh;
    api.pending[0].complete(_page('old')); await container.pump();
    expect(container.read(chartOfAccountsProvider).requireValue.single.id,'new');
  });
  test('chart overlapping refreshes retain latest source response', () async {
    final api=_DeferredChartApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'))]);
    addTearDown(container.dispose);
    final sub=container.listen(chartOfAccountsProvider,(_,_) {}); addTearDown(sub.close);
    api.pending[0].complete(_page('initial')); await container.read(chartOfAccountsProvider.future);
    final controller=container.read(chartOfAccountsProvider.notifier);
    final old=controller.refresh(); final latest=controller.refresh();
    api.pending[2].complete(_page('new')); await latest;
    api.pending[1].complete(_page('old')); await old;
    expect(container.read(chartOfAccountsProvider).requireValue.single.id,'new');
  });
  test('chart reloads server status after an uncertain status change', () async {
    final api=_MutableChartApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'))]);
    addTearDown(container.dispose);
    final sub=container.listen(chartOfAccountsProvider,(_,_) {}); addTearDown(sub.close);
    expect((await container.read(chartOfAccountsProvider.future)).single.isActive,isTrue);
    final error=await container.read(chartOfAccountsProvider.notifier).setActive('account',isActive:false);
    expect(error,isNotNull);
    await container.pump();
    expect((await container.read(chartOfAccountsProvider.future)).single.isActive,isFalse);
  });
}
