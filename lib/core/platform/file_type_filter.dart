/// Normalized suffixes accepted by both native and browser file dialogs.
/// Callers may supply `pdf`, `.pdf` or `*.pdf`; native Windows requires
/// wildcard patterns, not bare dot suffixes.
List<String> normalizeFileExtensions(List<String> extensions) {
  final result = <String>{};
  for (var extension in extensions) {
    extension = extension.trim().toLowerCase();
    if (extension.startsWith('*.')) extension = extension.substring(2);
    if (extension.startsWith('.')) extension = extension.substring(1);
    if (!RegExp(r'^[a-z0-9]+$').hasMatch(extension)) {
      throw ArgumentError.value(extension, 'extensions', 'Invalid file suffix');
    }
    result.add(extension);
  }
  return result.toList(growable: false);
}

String windowsFileFilter(List<String> extensions) {
  final suffixes = normalizeFileExtensions(extensions);
  if (suffixes.isEmpty) return 'All files (*.*)|*.*';
  final patterns = suffixes.map((value) => '*.$value').join(';');
  return 'Supported files ($patterns)|$patterns|All files (*.*)|*.*';
}
