import 'dart:typed_data';

/// A file the user chose, held in memory.
///
/// The whole file is read before it is sent: an import is a few thousand rows
/// at most, and holding it makes the progress and error reporting exact
/// instead of approximate.
class PickedFile {
  const PickedFile({
    required this.name,
    required this.bytes,
    required this.mimeType,
  });

  /// The name as the user knows it, e.g. `customers.xlsx`. Shown back to them
  /// so they can see they picked the right file.
  final String name;

  final Uint8List bytes;

  /// Sent as-is; the server decides what a file is from its contents, not
  /// from this.
  final String mimeType;

  int get sizeInBytes => bytes.length;

  String get readableSize {
    if (sizeInBytes < 1024) return '$sizeInBytes B';
    if (sizeInBytes < 1024 * 1024) {
      return '${(sizeInBytes / 1024).toStringAsFixed(0)} KB';
    }
    return '${(sizeInBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  bool get isSpreadsheet =>
      name.toLowerCase().endsWith('.xlsx') || name.toLowerCase().endsWith('.csv');

  bool get isJson => name.toLowerCase().endsWith('.json');
}
