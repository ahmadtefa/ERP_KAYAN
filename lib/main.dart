import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'core/logging/app_logger.dart';

void main() {
  AppLogger.init(verbose: true);
  runApp(const ProviderScope(child: ErpApp()));
}
