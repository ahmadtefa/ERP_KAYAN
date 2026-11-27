import 'dart:io';

import 'package:erp_kayan/features/data/presentation/backup_record_labels.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('every record kind the server counts has an Arabic and an English name', () {
    final source = File('backend/src/modules/backup/backup.service.ts').readAsStringSync();
    final models = RegExp(r"model: '([A-Za-z]+)'").allMatches(source).map((m) => m.group(1)!).toSet();
    expect(models.length, greaterThan(50));
    final missing = models.where((m) => !backupRecordLabels.containsKey(m)).toList()..sort();
    expect(missing, isEmpty, reason: 'add these to backupRecordLabels: $missing');
    final arabic = RegExp(r'[\u0600-\u06FF]');
    for (final entry in backupRecordLabels.entries) {
      expect(entry.value.length, 2, reason: entry.key);
      expect(arabic.hasMatch(entry.value[0]), isTrue, reason: '${entry.key} Arabic name');
      expect(arabic.hasMatch(entry.value[1]), isFalse, reason: '${entry.key} English name');
    }
  });

  test('labels follow the language and an unknown table never shows blank', () {
    expect(backupRecordLabel('salesInvoice', arabic: true), 'فواتير المبيعات');
    expect(backupRecordLabel('salesInvoice', arabic: false), 'sales invoices');
    expect(backupRecordLabel('someNewTable', arabic: true), 'some new table');
  });
}
