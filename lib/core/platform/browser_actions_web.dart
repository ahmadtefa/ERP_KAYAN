import 'dart:async';
// The browser's own API, used on purpose: a file the user chooses and a tab
// opened for a download are things only the page itself can do. This file is
// compiled for the web build and nothing else - see browser_actions.dart.
// ignore: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:html' as html;
import 'dart:typed_data';

import 'picked_file.dart';

/// Opens [url] in a new tab.
///
/// Used for a report download and for the print page. A plain download would
/// also work, but a new tab is what makes the print dialogue possible, and the
/// two buttons should behave the same way.
void openInNewTab(String url) {
  html.window.open(url, '_blank');
}

/// Asks the user for a file and reads it.
///
/// Returns null when the dialogue is closed without choosing anything, which
/// is a normal thing to do and not an error.
Future<PickedFile?> pickFile({List<String> extensions = const []}) async {
  final input = html.FileUploadInputElement();
  input.accept = extensions.isEmpty ? '' : extensions.join(',');
  // The file is read here and sent as bytes; no path on the user's machine is
  // ever involved.
  input.click();

  final completer = Completer<PickedFile?>();

  input.onChange.listen((_) {
    final files = input.files;
    if (files == null || files.isEmpty) {
      completer.complete(null);
      return;
    }
    final file = files.first;
    final reader = html.FileReader();
    reader.onLoad.listen((_) {
      final result = reader.result;
      final bytes = result is Uint8List
          ? result
          : Uint8List.fromList((result as List<int>?) ?? const <int>[]);
      completer.complete(
        PickedFile(
          name: file.name,
          bytes: bytes,
          mimeType: file.type.isEmpty ? 'application/octet-stream' : file.type,
        ),
      );
    });
    reader.onError.listen((_) {
      completer.completeError(StateError('The file could not be read: ${file.name}'));
    });
    reader.readAsArrayBuffer(file);
  });

  return completer.future;
}
