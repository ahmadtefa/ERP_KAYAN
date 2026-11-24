// Isolated CI harness. Calls the same desktop helpers without a server or licence.
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'package:erp_kayan/core/platform/backup_save_target_io.dart';
import 'package:erp_kayan/core/platform/browser_actions_stub.dart' as desktop;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const MaterialApp(
      home: Scaffold(body: Center(child: Text('KAYAN native dialog probe'))),
    ),
  );
  Future<void>(() async {
    final root = Directory(Platform.environment['KAYAN_PROBE_DIR']!);
    void stage(String s) =>
        File('${root.path}/stage.txt').writeAsStringSync(s, flush: true);
    try {
      await Future<void>.delayed(const Duration(seconds: 3));
      stage('save');
      final target = await chooseBackupSaveTarget();
      if (target == null) throw StateError('Save unexpectedly cancelled');
      final expected = File('${root.path}/chosen.dump');
      if (target.path.toLowerCase() !=
          expected.path.replaceAll('/', r'\').toLowerCase()) {
        throw StateError(
          'Wrong Save As path: ${target.path}, expected ${expected.path}',
        );
      }
      final bytes = Uint8List.fromList('PGDMP-native-dialog-probe'.codeUnits);
      await target.write(bytes);
      if ((await expected.readAsBytes()).join(',') != bytes.join(',')) {
        throw StateError('Readback differs');
      }
      stage('between');
      await Future<void>.delayed(const Duration(seconds: 3));
      stage('open');
      final picked = await desktop.pickFile(extensions: ['.json', '.dump']);
      if (picked == null ||
          picked.name != 'visible.json' ||
          String.fromCharCodes(picked.bytes) != '{}') {
        throw StateError('Wrong filtered file');
      }
      stage('between');
      await Future<void>.delayed(const Duration(seconds: 3));
      stage('cancel');
      if (await chooseBackupSaveTarget() != null) {
        throw StateError('Cancel returned a target');
      }
      stage('passed');
    } catch (e) {
      stage('failed: $e');
    }
  });
}
