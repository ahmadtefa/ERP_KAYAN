import 'package:flutter/foundation.dart';

/// Bumps the root Riverpod scope after operations that replace company or
/// system data. Recreating the scope disposes all cached feature providers so
/// every screen must read the committed database state again.
final ValueNotifier<int> appScopeEpoch = ValueNotifier<int>(0);

void restartAppScope() => appScopeEpoch.value++;
