import 'package:erp_kayan/core/backend/backend_gate.dart';
import 'package:erp_kayan/core/backend/local_backend.dart';
import 'package:flutter_test/flutter_test.dart';

/// The gate's screen decision, pinned branch by branch.
///
/// The regression that must never come back: on a real first install the
/// desktop shell reported "the database is empty, ask who the first
/// administrator is" and deliberately did not start a server — but the
/// gate treated "no address and no problem" as "carry on", opened the
/// whole program against a server that did not exist, and the user saw
/// «تعذر الوصول إلى الخادم» forever with the setup screen unreachable.
/// An empty database must ALWAYS route to the first-administrator
/// screen, whatever else is true.
void main() {
  group('backendGateScreenFor', () {
    test('an empty database goes to the first-administrator screen', () {
      const status = LocalBackendStatus.needsFirstAdministrator();
      expect(
        backendGateScreenFor(status: status, working: false),
        BackendGateScreen.firstAdministrator,
      );
      // Even mid-retry: the answer to "who is the first administrator"
      // is still missing, so the question stays on screen.
      expect(
        backendGateScreenFor(status: status, working: true),
        BackendGateScreen.firstAdministrator,
      );
    });

    test('the empty-database status is the trap this ordering defuses', () {
      // Documents WHY the naive guard failed: this status is neither
      // ready nor a failure, so any "not ready and no problem" shortcut
      // must be evaluated only after it.
      const status = LocalBackendStatus.needsFirstAdministrator();
      expect(status.isReady, isFalse);
      expect(status.problem, isNull);
      expect(status.needsFirstAdministrator, isTrue);
    });

    test('a ready backend opens the program against its address', () {
      const status = LocalBackendStatus.ready('http://127.0.0.1:3000/api/v1');
      expect(
        backendGateScreenFor(status: status, working: false),
        BackendGateScreen.ready,
      );
    });

    test('a failure shows the could-not-start screen with its reason', () {
      const status = LocalBackendStatus.failed('database did not answer');
      expect(
        backendGateScreenFor(status: status, working: false),
        BackendGateScreen.failed,
      );
      // While the retry the user just asked for is running, the gate
      // says it is working instead of leaving the old refusal up.
      expect(
        backendGateScreenFor(status: status, working: true),
        BackendGateScreen.waiting,
      );
    });

    test('before any verdict, a starting desktop copy waits honestly', () {
      expect(
        backendGateScreenFor(status: null, working: true),
        BackendGateScreen.waiting,
      );
      // Development and web builds never start a server: no status, no
      // work in flight, straight through to the program as before.
      expect(
        backendGateScreenFor(status: null, working: false),
        BackendGateScreen.passthrough,
      );
    });

    test('an unsupported build passes through and is not setup', () {
      const status = LocalBackendStatus.unsupported();
      expect(status.needsFirstAdministrator, isFalse);
      expect(
        backendGateScreenFor(status: status, working: false),
        BackendGateScreen.passthrough,
      );
    });
  });
}
