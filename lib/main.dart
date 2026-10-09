import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'core/backend/backend_gate.dart';
import 'core/logging/app_logger.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  AppLogger.init(verbose: true);

  // On the web, and on a developer's machine, the gate does nothing at all and
  // the program starts exactly as it always has. In a packaged desktop copy it
  // starts the API server this machine owns, waits for it to answer, and hands
  // the program the address it ended up on.
  runApp(const ProviderScope(child: BackendGate(child: ErpApp())));
}
