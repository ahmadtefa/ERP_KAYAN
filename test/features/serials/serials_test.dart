import 'package:erp_kayan/features/serials/presentation/serials_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a unit on the shelf can be scrapped, a sold one can come back, a scrapped one does nothing', () {
    expect(serialNextActions('IN_STOCK'), ['scrap']);
    expect(serialNextActions('SOLD'), ['return']);
    expect(serialNextActions('RETURNED'), ['scrap']);
    expect(serialNextActions('SCRAPPED'), isEmpty);
    expect(serialNextActions('SOMETHING_ELSE'), isEmpty);
  });
}
