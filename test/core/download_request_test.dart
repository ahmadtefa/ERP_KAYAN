import 'dart:typed_data';

import 'package:erp_kayan/core/platform/download_request.dart';
import 'package:flutter_test/flutter_test.dart';

Uint8List bytesOf(List<int> head, [int total = 64]) {
  final bytes = Uint8List(total);
  bytes.setRange(0, head.length, head);
  return bytes;
}

void main() {
  group('validateDownloadedFile', () {
    test('accepts a real PDF', () {
      // %PDF-
      final pdf = bytesOf([0x25, 0x50, 0x44, 0x46, 0x2d]);
      expect(() => validateDownloadedFile(pdf, 'quotation.pdf'), returnsNormally);
    });

    test('refuses an HTML page saved under a PDF name', () {
      final html = Uint8List.fromList('<!doctype html><html></html>'.codeUnits);
      expect(
        () => validateDownloadedFile(html, 'quotation.pdf'),
        throwsA(isA<DownloadFailure>()),
      );
    });

    test('accepts a real spreadsheet and refuses a page in its place', () {
      // PK\x03\x04
      final xlsx = bytesOf([0x50, 0x4b, 0x03, 0x04]);
      expect(
        () => validateDownloadedFile(xlsx, 'kayan-template-opening-balances.xlsx'),
        returnsNormally,
      );
      final json = Uint8List.fromList('{"detail":"no"}'.codeUnits);
      expect(
        () => validateDownloadedFile(json, 'template.xlsx'),
        throwsA(isA<DownloadFailure>()),
      );
    });

    test('refuses an empty answer for any file name', () {
      expect(
        () => validateDownloadedFile(Uint8List(0), 'report.pdf'),
        throwsA(isA<DownloadFailure>()),
      );
      expect(
        () => validateDownloadedFile(Uint8List(0), 'report.csv'),
        throwsA(isA<DownloadFailure>()),
      );
    });

    test('leaves text formats to the server status alone', () {
      final csv = Uint8List.fromList('code,name\n1,One\n'.codeUnits);
      expect(() => validateDownloadedFile(csv, 'report.csv'), returnsNormally);
    });
  });
}
