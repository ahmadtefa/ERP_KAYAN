import 'package:flutter_test/flutter_test.dart';
import 'package:erp_kayan/features/cheques/presentation/cheques_screen.dart';

void main() {
  test('received cheque life cycle offers only the allowed steps', () {
    expect(chequeNextActions('RECEIVED', 'HELD'), ['deposit', 'bounce', 'cancel']);
    expect(chequeNextActions('RECEIVED', 'DEPOSITED'), ['collect', 'bounce']);
    expect(chequeNextActions('RECEIVED', 'BOUNCED'), ['represent', 'cancel']);
    expect(chequeNextActions('RECEIVED', 'COLLECTED'), isEmpty);
    expect(chequeNextActions('RECEIVED', 'CANCELLED'), isEmpty);
  });

  test('issued cheque is cleared straight from held, never deposited', () {
    expect(chequeNextActions('ISSUED', 'HELD'), ['collect', 'bounce', 'cancel']);
    expect(chequeNextActions('ISSUED', 'HELD'), isNot(contains('deposit')));
  });
}
