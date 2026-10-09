import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:url_launcher/url_launcher.dart';

import 'picked_file.dart';

/// Opens a report, print view, or browser-served API file in the system browser.
void openInNewTab(String url) {
  unawaited(launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication));
}

/// Uses the native file picker on Windows/macOS/Linux and reads only the file
/// the user chose into memory for the existing upload/import flow.
Future<PickedFile?> pickFile({List<String> extensions = const []}) async {
  final accepted = extensions
      .map((value) => value.startsWith('.') ? value.substring(1) : value)
      .where((value) => value.isNotEmpty)
      .toList(growable: false);
  final file = await openFile(
    acceptedTypeGroups: accepted.isEmpty
        ? const <XTypeGroup>[]
        : [XTypeGroup(label: 'Supported files', extensions: accepted)],
  );
  if (file == null) return null;
  final name = file.name;
  final extension = name.contains('.')
      ? name.split('.').last.toLowerCase()
      : '';
  final mime = switch (extension) {
    'png' => 'image/png',
    'jpg' || 'jpeg' => 'image/jpeg',
    'webp' => 'image/webp',
    'xlsx' =>
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'csv' => 'text/csv',
    'json' => 'application/json',
    _ => 'application/octet-stream',
  };
  return PickedFile(
    name: name,
    bytes: await file.readAsBytes(),
    mimeType: mime,
  );
}
