import 'package:erp_kayan/core/backend/setup_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('an existing company without users is recovery, never first-run setup', () {
    expect(setupRequiresRecovery(preparationState: 'recovery_required'), isTrue);
    expect(setupRequiresRecovery(healthValue: true), isTrue);
    expect(setupRequiresRecovery(preparationState: 'empty'), isFalse);
    expect(setupRequiresRecovery(preparationState: 'incomplete'), isFalse);
    expect(setupRequiresRecovery(healthValue: false), isFalse);
    expect(setupRequiresRecovery(), isFalse);
  });
}
