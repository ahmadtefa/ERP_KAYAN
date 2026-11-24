import 'dart:async';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/reports/presentation/report_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import '../widget/test_harness.dart';

class _Session extends Notifier<AppUser?> {
  @override AppUser? build() => null;
  void change(AppUser? user) => state = user;
}
final _session = NotifierProvider<_Session, AppUser?>(_Session.new);
class _Api extends ApiClient {
  _Api(): super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  String principal = '';
  int calls = 0;
  Completer<Map<String, dynamic>>? pending;
  @override Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async {
    calls++;
    if (pending != null) { final value = pending!; pending = null; return value.future; }
    return {'principal': principal, 'path': path};
  }
}
AppUser _user(String id, {String company='company-a', String branch='branch-a', List<String> permissions=const ['dashboard.view']}) =>
  AppUser(id:id,username:id,fullName:'Fixture',companyId:company,branchId:branch,roles:const ['ADMIN'],permissions:permissions);

void main() {
  test('dashboard and report caches follow sign-out, user/company/branch/grant changes', () async {
    final api = _Api();
    final container = ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWith((ref)=>ref.watch(_session))]);
    addTearDown(container.dispose);
    final summary=container.listen(dashboardSummaryProvider, (_, _) {});
    final monthly=container.listen(dashboardMonthlyProvider, (_, _) {});
    final report=container.listen(reportProvider('/reports/sales'), (_, _) {});
    addTearDown(summary.close);addTearDown(monthly.close);addTearDown(report.close);
    Future<void> expectPrincipal(String? expected) async {
      for (final provider in [dashboardSummaryProvider,dashboardMonthlyProvider,reportProvider('/reports/sales')]) {
        final result=await container.read(provider.future);
        if(expected==null) { expect(result,isEmpty); } else { expect(result['principal'],expected); }
      }
    }
    await expectPrincipal(null);expect(api.calls,0);
    for(final user in [_user('one'),_user('two'),_user('two',company:'company-b'),_user('two',company:'company-b',branch:'branch-b'),_user('two',permissions:[])]) {
      api.principal='${user.id}/${user.companyId}/${user.branchId}/${user.permissions.length}';
      final before=api.calls;
      container.read(_session.notifier).change(user);
      await expectPrincipal(api.principal);
      expect(api.calls,before+3);
    }
    container.read(_session.notifier).change(null);
    await expectPrincipal(null);
  });
  test('late response from old principal cannot overwrite current dashboard result', () async {
    final api=_Api();final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWith((ref)=>ref.watch(_session))]);
    addTearDown(container.dispose);
    final subscription=container.listen(dashboardSummaryProvider,(_,_){});addTearDown(subscription.close);
    final old=Completer<Map<String,dynamic>>();api.pending=old;
    container.read(_session.notifier).change(_user('old'));
    final oldFuture=container.read(dashboardSummaryProvider.future);
    // Force first evaluation to start before switching identities.
    await Future<void>.delayed(Duration.zero);
    expect(api.calls,1);
    api.principal='new';container.read(_session.notifier).change(_user('new'));
    expect((await container.read(dashboardSummaryProvider.future))['principal'],'new');
    old.complete({'principal':'old'});await oldFuture;
    await Future<void>.delayed(Duration.zero);
    expect(container.read(dashboardSummaryProvider).asData?.value['principal'],'new');
  });
}
