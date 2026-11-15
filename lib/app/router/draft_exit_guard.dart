import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Guards only a matching draft route instance: stacked editors must not share a
/// callback, and disposing an old page must not unregister the newer one.
class DraftExitGuard {
  final Map<ValueKey<String>, Future<bool> Function()> _guards = {};
  void register(ValueKey<String> key, Future<bool> Function() guard) => _guards[key] = guard;
  void unregister(ValueKey<String> key, Future<bool> Function() guard) {
    if (_guards[key] == guard) _guards.remove(key);
  }
  // A missing registration is not evidence that a draft is clean.
  Future<bool> canLeave(ValueKey<String> key) => _guards[key]?.call() ?? Future.value(false);

  /// Whether any guard is registered for this key.
  ///
  /// Needed to tell "nobody claimed this page" from "a screen claimed it and
  /// then let go". Those two are not the same: the first is what the shell must
  /// cover, the second must not be overwritten while the screen is still shown.
  bool has(ValueKey<String> key) => _guards.containsKey(key);

  /// How many guards are currently registered.
  ///
  /// Guards are keyed by page key, and go_router issues a new key per page. A
  /// widget that registers for a key it does not later release leaves an entry
  /// behind for every visit, so the map grows for the whole session. The count
  /// is exposed so a test can see that growth instead of asserting it cannot
  /// happen.
  int get registeredCount => _guards.length;
}
final draftExitGuardProvider = Provider<DraftExitGuard>((ref) => DraftExitGuard());

/// An imperative page stack can sit above one routed list. The topmost page
/// decides whether leaving the parent route is safe; removing an older page
/// must not remove the newer page's guard.
class DraftExitRelay {
  final List<Future<bool> Function()> _guards = [];
  void attach(Future<bool> Function() guard) => _guards.add(guard);
  void detach(Future<bool> Function() guard) => _guards.remove(guard);
  Future<bool> canLeave() => _guards.isEmpty ? Future.value(true) : _guards.last();
}
