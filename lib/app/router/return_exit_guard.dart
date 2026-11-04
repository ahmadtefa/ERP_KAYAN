import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Guards only a matching route instance: stacked editors must not share a
/// callback, and disposing an old page must not unregister the newer one.
class ReturnExitGuard {
  final Map<ValueKey<String>, Future<bool> Function()> _guards = {};
  void register(ValueKey<String> key, Future<bool> Function() guard) => _guards[key] = guard;
  void unregister(ValueKey<String> key, Future<bool> Function() guard) {
    if (_guards[key] == guard) _guards.remove(key);
  }
  // A missing registration is not evidence that a draft is clean.
  Future<bool> canLeave(ValueKey<String> key) => _guards[key]?.call() ?? Future.value(false);
}
final returnExitGuardProvider = Provider<ReturnExitGuard>((ref) => ReturnExitGuard());
