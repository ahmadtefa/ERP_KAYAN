import 'package:erp_kayan/features/orders/presentation/order_retry_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
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
