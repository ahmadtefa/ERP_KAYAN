import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:erp_kayan/core/image/company_logo_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<Uint8List> _pngImage(int width, int height) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()));
  canvas.drawRect(
    Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
    Paint()..color = Colors.indigo,
  );
  final image = await recorder.endRecording().toImage(width, height);
  try {
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data!.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
  } finally {
    image.dispose();
  }
}

void main() {
  test('normalizes a large PNG to at most 1024 pixels and PNG bytes', () async {
    final source = await _pngImage(2048, 1024);
    final normalized = await normalizeCompanyLogo(source);

    expect(normalized.length, lessThanOrEqualTo(companyLogoMaxBytes));
    expect(normalized.take(8), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    final buffer = await ui.ImmutableBuffer.fromUint8List(normalized);
    final descriptor = await ui.ImageDescriptor.encoded(buffer);
    try {
      expect(descriptor.width, lessThanOrEqualTo(companyLogoMaxDimension));
      expect(descriptor.height, lessThanOrEqualTo(companyLogoMaxDimension));
      expect(descriptor.width, greaterThanOrEqualTo(32));
      expect(descriptor.height, greaterThanOrEqualTo(32));
    } finally {
      descriptor.dispose();
      buffer.dispose();
    }
  });

  test('refuses unsupported or too-small images before upload', () async {
    await expectLater(
      normalizeCompanyLogo(Uint8List.fromList([1, 2, 3, 4])),
      throwsA(isA<CompanyLogoImageException>()),
    );
    final tiny = await _pngImage(16, 16);
    await expectLater(
      normalizeCompanyLogo(tiny),
      throwsA(isA<CompanyLogoImageException>()),
    );
  });
}
