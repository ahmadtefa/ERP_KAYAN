import 'package:erp_kayan/features/commissions/presentation/commissions_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final entries = [
    {'repId': 'a', 'status': 'ACCRUED', 'amount': 25.0},
    {'repId': 'a', 'status': 'ACCRUED', 'amount': -2.5},
    {'repId': 'a', 'status': 'PAID', 'amount': 100},
    {'repId': 'b', 'status': 'ACCRUED', 'amount': '10.10'},
  ];

  test('the preview adds only the unpaid entries and takes returns off', () {
    expect(unpaidNetPiasters(entries), 3260);
    expect(unpaidNetPiasters(entries, repId: 'a'), 2250);
    expect(unpaidNetPiasters(entries, repId: 'b'), 1010);
    expect(unpaidNetPiasters(const []), 0);
  });

  test('piasters read back as money with two decimals', () {
    expect(piastersText(3260), '32.60');
    expect(piastersText(-250), '-2.50');
    expect(piastersText(5), '0.05');
  });
}
