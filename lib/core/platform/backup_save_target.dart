import 'dart:typed_data';

import 'backup_save_target_stub.dart'
    if (dart.library.io) 'backup_save_target_io.dart' as platform;

abstract class BackupSaveTarget {
  String get path;
  Future<void> write(Uint8List bytes);
}

Future<BackupSaveTarget?> chooseBackupSaveTarget() => platform.chooseBackupSaveTarget();
