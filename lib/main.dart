import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'core/app/app_scope_restart.dart';
import 'core/backend/backend_gate.dart';
import 'core/logging/app_logger.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  AppLogger.init(verbose: true);

  // On the web, and on a developer's machine, the gate does nothing at all and
  // the program starts exactly as it always has. In a packaged desktop copy it
  // starts the API server this machine owns, waits for it to answer, and hands
  // the program the address it ended up on.
  runApp(const _RestartableApp());
}

/// Recreates the complete provider container after a destructive restore.
/// A normal widget rebuild would leave FutureProvider/AsyncNotifier caches
/// alive, which made the restored database look unchanged until restart.
class _RestartableApp extends StatelessWidget {
  const _RestartableApp();

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<int>(
    valueListenable: appScopeEpoch,
    builder: (context, epoch, _) => ProviderScope(
      key: ValueKey(epoch),
      child: const BackendGate(child: ErpApp()),
    ),
  );
}
