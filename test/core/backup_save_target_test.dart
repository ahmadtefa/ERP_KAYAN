import 'dart:io';
import 'dart:typed_data';
import 'package:erp_kayan/core/platform/backup_save_target_io.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('writes chosen file exactly and cleans staging, including replacement', () async {
    final dir = await Directory.systemTemp.createTemp('kayan-save-test-');
    addTearDown(() => dir.delete(recursive: true));
    final path = '${dir.path}/chosen.dump';
    final bytes = Uint8List.fromList([80,71,68,77,80,0,255,42]);
    await writeVerifiedBackupFile(path, bytes);
    expect(await File(path).readAsBytes(), bytes);
    await writeVerifiedBackupFile(path, Uint8List.fromList([...bytes, 9]));
    expect(await File(path).readAsBytes(), [...bytes,9]);
    expect(dir.listSync().length, 1);
  });
  test('invalid target fails without an alternate output or lost existing file', () async {
    final dir = await Directory.systemTemp.createTemp('kayan-save-test-');
    addTearDown(() => dir.delete(recursive: true));
    final existing = File('${dir.path}/existing.dump');
    await existing.writeAsString('keep');
    await expectLater(writeVerifiedBackupFile('${dir.path}/absent/chosen.dump', Uint8List.fromList([80])),
      throwsA(isA<FileSystemException>()));
    expect(await existing.readAsString(), 'keep');
    expect(dir.listSync().length, 1);
  });
}
