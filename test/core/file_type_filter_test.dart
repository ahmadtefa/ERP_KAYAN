import 'package:erp_kayan/core/platform/file_type_filter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('image suffixes use native Windows wildcards by default', () {
    expect(windowsFileFilter(['.png', '.jpg', '.jpeg', '.webp']),
      'Supported files (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp|All files (*.*)|*.*');
  });
  test('PDF background bare suffix and mixed backup/import suffixes normalize', () {
    expect(windowsFileFilter(['pdf']), contains('|*.pdf|'));
    expect(normalizeFileExtensions(['.DUMP', '*.json', 'csv', '.dump']),
      ['dump', 'json', 'csv']);
    expect(windowsFileFilter(['.xlsx', '.csv']), contains('|*.xlsx;*.csv|'));
    expect(windowsFileFilter(['.kayanbackup', '.dump', '.json']),
      contains('|*.kayanbackup;*.dump;*.json|'));
  });
  test('empty selection stays unrestricted, unsafe patterns are rejected', () {
    expect(windowsFileFilter([]), 'All files (*.*)|*.*');
    for (final value in ['*', '.pdf|*.*', '../json', 'png;jpg']) {
      expect(() => windowsFileFilter([value]), throwsArgumentError);
    }
  });
}
