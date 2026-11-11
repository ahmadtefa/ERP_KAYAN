import 'package:flutter_test/flutter_test.dart';

import 'package:erp_kayan/app/router/draft_exit_guard.dart';

/// Walking the warehouse menu used to freeze the app: the operator could open
/// a warehouse screen and then nothing happened when they chose another one.
///
/// The cause was not a rendering problem and not a slow request. Every route in
/// `_guardedShellPaths` asks `DraftExitGuard.canLeave(pageKey)` before the
/// router will leave it, and `canLeave` answers **false** when it has no
/// registration for that key - a deliberate choice, because a missing
/// registration is not evidence that a draft is clean. Nine warehouse screens
/// were listed as guarded but never registered themselves, so their answer was
/// always "no": the route was never left, no error was shown, and the app
/// looked frozen.
///
/// These tests pin the rule from both sides: an unregistered key must block
/// (that default is what makes a half-wired screen look like a freeze), and a
/// screen that follows the register/unregister contract must allow leaving.
void main() {
  group('DraftExitGuard', () {
    test('an unregistered page cannot be left', () async {
      final guard = DraftExitGuard();
      final allowed = await guard.canLeave(const ValueKey('unregistered'));

      expect(
        allowed,
        isFalse,
        reason: 'the default is deliberately restrictive; that is why a screen '
            'which forgets to register itself blocks navigation entirely',
      );
    });

    test('a registered page that has nothing to protect can be left', () async {
      final guard = DraftExitGuard();
      const key = ValueKey('stock-takes');
      Future<bool> nothingToProtect() => Future.value(true);

      guard.register(key, nothingToProtect);

      expect(
        await guard.canLeave(key),
        isTrue,
        reason: 'a screen with no unsaved work must not block the operator',
      );
    });

    test('a registered page with unsaved work blocks leaving', () async {
      final guard = DraftExitGuard();
      const key = ValueKey('stock-takes');
      Future<bool> hasUnsavedWork() => Future.value(false);

      guard.register(key, hasUnsavedWork);

      expect(
        await guard.canLeave(key),
        isFalse,
        reason: 'unsaved work must still be protected',
      );
    });

    test('unregistering restores the blocking default', () async {
      final guard = DraftExitGuard();
      const key = ValueKey('batches');
      Future<bool> allow() => Future.value(true);

      guard.register(key, allow);
      expect(await guard.canLeave(key), isTrue);

      guard.unregister(key, allow);
      expect(
        await guard.canLeave(key),
        isFalse,
        reason: 'after the screen is gone its key must not stay open',
      );
    });

    /// This is the safety property the whole fix rests on. `DraftExitGuard`
    /// stores one callback per page key, so whichever widget registers last
    /// wins. The shell registers a permissive floor from its own `initState`,
    /// and a screen registers its real guard from *its* `initState`. Flutter
    /// initialises a parent before its child, so the screen's guard is written
    /// last and is the one consulted. If that ordering were ever reversed the
    /// floor would silently disarm every unsaved-work guard in the application,
    /// which trades a freeze for data loss.
    test('a later registration replaces the permissive floor', () async {
      final guard = DraftExitGuard();
      const key = ValueKey('items');
      Future<bool> floor() async => true;
      Future<bool> screenWithEdits() async => false;

      // Shell first, screen second - the order Flutter uses for initState.
      guard.register(key, floor);
      expect(await guard.canLeave(key), isTrue,
          reason: 'the floor alone must permit leaving');

      guard.register(key, screenWithEdits);
      expect(
        await guard.canLeave(key),
        isFalse,
        reason: 'the real draft guard must outrank the floor; if this passes '
            'the other way round the app loses unsaved work',
      );

      guard.unregister(key, screenWithEdits);
      expect(
        guard.has(key),
        isFalse,
        reason: 'the map holds one callback per key, so the screen guard did '
            'not sit on top of the floor - it replaced it. Once the screen '
            'unregisters, the key is gone entirely.',
      );
      // This is why ErpShell re-claims the floor from build: without it the
      // restrictive default comes back while the shell is still on screen,
      // which is the original freeze arriving late.
      expect(
        await guard.canLeave(key),
        isFalse,
        reason: 'the restrictive default takes over the moment the key is free; '
            'the shell is responsible for re-claiming it',
      );
    });

    /// A screen must not be able to remove a guard it did not install, and the
    /// floor must not remove a screen's guard.
    test('each callback can only remove itself', () async {
      final guard = DraftExitGuard();
      const key = ValueKey('stock');
      Future<bool> floor() async => true;
      Future<bool> screenWithEdits() async => false;

      guard.register(key, floor);
      guard.register(key, screenWithEdits);

      // The shell releasing its floor must not disarm the screen's guard.
      guard.unregister(key, floor);
      expect(await guard.canLeave(key), isFalse,
          reason: 'releasing the floor must not remove the screen guard that '
              'had replaced it; the map no longer holds the floor at all');
    });

    test('has() distinguishes free from claimed', () async {
      final guard = DraftExitGuard();
      const key = ValueKey('batches');
      Future<bool> allow() async => true;

      expect(guard.has(key), isFalse);
      guard.register(key, allow);
      expect(guard.has(key), isTrue);
      guard.unregister(key, allow);
      expect(
        guard.has(key),
        isFalse,
        reason: 'the floor may only be re-claimed when the key is genuinely '
            'free; reporting a taken key as free would overwrite a draft guard',
      );
    });

    test('the registered count reflects what is actually held', () async {
      final guard = DraftExitGuard();
      Future<bool> allow() => Future.value(true);

      expect(guard.registeredCount, 0);

      guard.register(const ValueKey('a'), allow);
      guard.register(const ValueKey('b'), allow);
      expect(guard.registeredCount, 2);

      // Re-registering the same key replaces rather than adds, which is what
      // lets a screen's own guard take over from the shell's floor.
      guard.register(const ValueKey('a'), allow);
      expect(guard.registeredCount, 2);

      guard.unregister(const ValueKey('a'), allow);
      expect(guard.registeredCount, 1,
          reason: 'a key that is left behind keeps growing the map for the rest '
              'of the session');

      guard.unregister(const ValueKey('b'), allow);
      expect(guard.registeredCount, 0);
    });

    test('unregistering with a different callback leaves the guard in place',
        () async {
      final guard = DraftExitGuard();
      const key = ValueKey('warehouses');
      Future<bool> newest() => Future.value(true);
      Future<bool> older() => Future.value(false);

      guard.register(key, newest);
      // A page below the newest one being disposed must not disarm the newest.
      guard.unregister(key, older);

      expect(
        await guard.canLeave(key),
        isTrue,
        reason: 'only the registered callback may remove itself',
      );
    });
  });
}
