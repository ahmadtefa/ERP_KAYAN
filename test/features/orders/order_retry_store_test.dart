import 'package:erp_kayan/features/orders/presentation/order_retry_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('a local restart preserves scope across changing backend ports', () {
    String scope(String url, {bool embedded = true}) => orderRetryScope(apiBaseUrl: url, companyId: 'c',
      branchId: 'b', userId: 'u', kind: 'sales', orderId: 'o', embeddedLocalServer: embedded);
    expect(scope('http://127.0.0.1:3000/api/v1'), scope('http://127.0.0.1:3201/api/v1'));
    expect(scope('https://one.example/api/v1'), isNot(scope('https://two.example/api/v1')));
    expect(scope('http://127.0.0.1:3000/api/v1', embedded: false),
      isNot(scope('http://127.0.0.1:3201/api/v1', embedded: false)));
  });
  test('keeps the exact key and payload until success, and isolates scope', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final store = OrderRetryStore(prefs);
    final first = await store.begin('company.branch.user.order', method: 'POST',
      path: '/sales/orders/one/invoice', body: {'lines': [{'orderLineId': 'line', 'quantity': '2'}]});
    final restarted = OrderRetryStore(prefs).read('company.branch.user.order');
    expect(restarted, first);
    expect(store.read('other.branch.user.order'), isNull);
    await expectLater(store.begin('company.branch.user.order', method: 'POST',
      path: '/sales/orders/one/invoice', body: {}), throwsStateError);
    await store.complete('company.branch.user.order');
    expect(store.read('company.branch.user.order'), isNull);
  });
}
