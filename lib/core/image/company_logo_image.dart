import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

/// The stored logo format. Keeping client output predictable also means the
/// server's multipart size limit applies to the resized bytes, not the source.
const int companyLogoMaxBytes = 2 * 1024 * 1024;
const int companyLogoMaxDimension = 1024;

class CompanyLogoImageException implements Exception {
  const CompanyLogoImageException(this.tooLarge);

  final bool tooLarge;
}

/// Validates a PNG/JPEG/WebP and returns a PNG scaled to fit 1024×1024 and
/// the server's 2 MB limit. Dimensions are read from the encoded descriptor so
/// a large compressed image is never fully decoded at its original size.
Future<Uint8List> normalizeCompanyLogo(Uint8List source) async {
  if (!_hasSupportedSignature(source) || source.length > 20 * 1024 * 1024) {
    throw const CompanyLogoImageException(false);
  }

  ui.ImmutableBuffer? buffer;
  ui.ImageDescriptor? descriptor;
  try {
    buffer = await ui.ImmutableBuffer.fromUint8List(source);
    descriptor = await ui.ImageDescriptor.encoded(buffer);
  } on Object {
    buffer?.dispose();
    throw const CompanyLogoImageException(false);
  }

  try {
    final width = descriptor.width;
    final height = descriptor.height;
    if (width < 32 || height < 32 || width <= 0 || height <= 0) {
      throw const CompanyLogoImageException(false);
    }

    // Re-encode at progressively smaller bounds if a detailed source image
    // still exceeds the storage limit. Aspect ratio is preserved at each step.
    for (final bound in const [1024, 768, 512, 384, 256]) {
      final scale = math.min(1.0, bound / math.max(width, height));
      final targetWidth = math.max(1, (width * scale).round()).toInt();
      final targetHeight = math.max(1, (height * scale).round()).toInt();
      ui.Codec? codec;
      ui.FrameInfo? frame;
      try {
        codec = await descriptor.instantiateCodec(
          targetWidth: scale < 1 ? targetWidth : null,
          targetHeight: scale < 1 ? targetHeight : null,
        );
        frame = await codec.getNextFrame();
        final data = await frame.image.toByteData(format: ui.ImageByteFormat.png);
        if (data == null) continue;
        final bytes = data.buffer.asUint8List(
          data.offsetInBytes,
          data.lengthInBytes,
        );
        if (bytes.lengthInBytes <= companyLogoMaxBytes) {
          return Uint8List.fromList(bytes);
        }
      } on CompanyLogoImageException {
        rethrow;
      } on Object {
        throw const CompanyLogoImageException(false);
      } finally {
        frame?.image.dispose();
        codec?.dispose();
      }
    }
    throw const CompanyLogoImageException(true);
  } finally {
    descriptor.dispose();
    buffer.dispose();
  }
}

bool _hasSupportedSignature(Uint8List bytes) {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length) {
    var matchesPng = true;
    for (var index = 0; index < png.length; index += 1) {
      if (bytes[index] != png[index]) {
        matchesPng = false;
        break;
      }
    }
    if (matchesPng) return true;
  }
  if (bytes.length >= 3 &&
      bytes[0] == 0xff &&
      bytes[1] == 0xd8 &&
      bytes[2] == 0xff) {
    return true;
  }
  return bytes.length >= 12 &&
      bytes[0] == 0x52 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x46 &&
      bytes[8] == 0x57 &&
      bytes[9] == 0x45 &&
      bytes[10] == 0x42 &&
      bytes[11] == 0x50;
}
