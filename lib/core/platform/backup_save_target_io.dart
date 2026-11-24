import 'dart:io';
import 'dart:typed_data';
import 'package:file_selector/file_selector.dart';
import 'backup_save_target.dart';

Future<BackupSaveTarget?> chooseBackupSaveTarget() async {
  final chosen = await getSaveLocation(
    suggestedName: 'kayan-${DateTime.now().toIso8601String().replaceAll(':', '-')}.dump',
    acceptedTypeGroups: const [XTypeGroup(label: 'PostgreSQL backup', extensions: ['dump'])],
  );
  return chosen == null ? null : _FileTarget(chosen.path);
}

class _FileTarget implements BackupSaveTarget {
  _FileTarget(this.path);
  @override
  final String path;
  @override
  Future<void> write(Uint8List bytes) => writeVerifiedBackupFile(path, bytes);
}

/// Stage and verify alongside the destination before replacing it. A failed
/// transfer must not truncate an existing backup selected for replacement.
Future<void> writeVerifiedBackupFile(String path, Uint8List bytes) async {
  final destination = File(path);
  final staging = await destination.parent.createTemp('.kayan-backup-');
  try {
    final temporary = File('${staging.path}${Platform.pathSeparator}archive.dump');
    await temporary.writeAsBytes(bytes, flush: true);
    final actual = await temporary.readAsBytes();
    if (actual.length != bytes.length) throw const FileSystemException('Backup size verification failed');
    for (var i = 0; i < bytes.length; i++) {
      if (actual[i] != bytes[i]) throw const FileSystemException('Backup read-back verification failed');
    }
    await temporary.rename(destination.path);
  } finally {
    await staging.delete(recursive: true);
  }
}
