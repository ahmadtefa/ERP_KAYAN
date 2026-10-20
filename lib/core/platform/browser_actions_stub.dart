/// Used when the program is built for something that is not a browser.
///
/// The desktop copy does not need to give up here. A print page opens in the
/// machine's own browser - the address already carries everything the
/// server needs - and choosing a file uses the system's own dialogue.
///
/// A download is handed to that browser too, but only after the program has
/// asked the server whether the file is really there: a button that opens
/// the browser and comes back with nothing is exactly the silence this is
/// here to prevent.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'download_request.dart';
import 'picked_file.dart';

/// Opens [url] in the machine's default browser.
///
/// The browser then shows the print page and its print dialogue. The server
/// listens on this machine, so the browser can reach the address as-is.
void openInNewTab(String url) => _openInBrowser(url);

/// Checks the server really has the file, then lets the machine's browser
/// fetch it.
///
/// The address is opened in the browser because only it knows where this
/// person's downloads go. Before that the program asks for the answer itself
/// and reads only the status - not the file, which would double the
/// transfer - so that a refusal is reported on this screen instead of
/// turning into an error page nobody asked for.
Future<void> downloadFile(DownloadRequest request) async {
  final uri = Uri.tryParse(request.url);
  if (uri == null) {
    throw const DownloadFailure('The address for this file is not valid.');
  }

  final client = HttpClient();
  try {
    final httpRequest = await client.getUrl(uri);
    final response = await httpRequest.close();
    if (Platform.isWindows) {
      // Windows desktop must let the user choose the actual destination;
      // handing the URL to a browser silently picks that browser's Downloads
      // folder and is not equivalent to saving the file in KAYAN.
      final bytes = await response.fold<BytesBuilder>(
        BytesBuilder(copy: false),
        (builder, chunk) => builder..add(chunk),
      );
      final payload = bytes.takeBytes();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final body = utf8.decode(payload, allowMalformed: true);
        throw DownloadFailure(
          _reasonFrom(body, response.statusCode),
          statusCode: response.statusCode,
        );
      }
      final disposition = response.headers.value(HttpHeaders.contentDispositionHeader);
      final fromHeader = disposition == null
          ? null
          : RegExp(r'filename="?([^";]+)"?').firstMatch(disposition)?.group(1);
      final suggested = _safeFileName(
        request.fileName ??
            fromHeader ??
            (uri.pathSegments.isNotEmpty ? uri.pathSegments.last : 'download.pdf'),
      );
      final path = await _chooseSavePath(suggested);
      if (path == null) {
        throw const DownloadFailure('Saving the file was cancelled.');
      }
      final file = File(path);
      await file.writeAsBytes(payload, flush: true);
      if (!await file.exists() || await file.length() != payload.length) {
        throw const DownloadFailure(
          'The file could not be verified after saving. Choose another location and try again.',
        );
      }
      return;
    }
    if (response.statusCode >= 400) {
      final body = await response
          .transform(const Utf8Decoder(allowMalformed: true))
          .take(2000)
          .join();
      throw DownloadFailure(
        _reasonFrom(body, response.statusCode),
        statusCode: response.statusCode,
      );
    }
    // The file itself is the browser's job on non-Windows desktop; this
    // socket has said all it needed to.
    final socket = await response.detachSocket();
    socket.destroy();
  } on DownloadFailure {
    rethrow;
  } on SocketException catch (error) {
    throw DownloadFailure(
      'The program could not reach the server: ${error.message}',
    );
  } finally {
    client.close(force: true);
  }

  _openInBrowser(request.url);
}


/// Opens the native Windows Save As dialogue and returns the chosen path.
/// An empty result means the user cancelled; no file is reported as saved.
Future<String?> _chooseSavePath(String suggestedName) async {
  final safe = suggestedName.replaceAll("'", "''");
  final script = 'Add-Type -AssemblyName System.Windows.Forms\n'
      r'$dialog = New-Object System.Windows.Forms.SaveFileDialog' '\n'
      r'$dialog.OverwritePrompt = $true' '\n'
      r'$dialog.FileName = ' "'$safe'" '\n'
      r'$dialog.Filter = "PDF document (*.pdf)|*.pdf|All files (*.*)|*.*"' '\n'
      r'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) '
      r'{ [Console]::Out.Write($dialog.FileName) }';
  final result = await Process.run('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
  if (result.exitCode != 0) {
    throw StateError(
      'The Save As dialogue could not be opened: ${result.stderr}'.trim(),
    );
  }
  final path = '${result.stdout}'.trim();
  return path.isEmpty ? null : path;
}

String _safeFileName(String name) {
  final cleaned = name
      .replaceAll(RegExp(r'[<>:"/\\|?*\x00-\x1F]'), '_')
      .trim();
  return cleaned.isEmpty ? 'quotation.pdf' : cleaned;
}

/// The server's own explanation, when it sent one (RFC 9457 `detail`).
String _reasonFrom(String body, int status) {
  try {
    final decoded = jsonDecode(body);
    if (decoded is Map && decoded['detail'] is String) {
      return decoded['detail'] as String;
    }
  } catch (_) {
    // Not JSON: the plain text will do.
  }
  final trimmed = body.trim();
  return trimmed.isEmpty
      ? 'The server would not send the file (HTTP $status).'
      : trimmed;
}

void _openInBrowser(String url) {
  final Future<Process> started;
  if (Platform.isWindows) {
    // The documented Windows way to open a URL with the user's own browser,
    // with no shell involved and therefore no quoting traps in the address.
    started = Process.start(
      'rundll32',
      ['url.dll,FileProtocolHandler', url],
      mode: ProcessStartMode.detached,
    );
  } else if (Platform.isMacOS) {
    started = Process.start('open', [url], mode: ProcessStartMode.detached);
  } else {
    started = Process.start('xdg-open', [url], mode: ProcessStartMode.detached);
  }
  // Fire and forget: these calls are the void "open/download" buttons. If
  // the machine's browser cannot be started there is no screen to tell -
  // that is a machine problem, not a silent one, because the browser itself
  // is what reports the next step.
  unawaited(started.then<void>((_) {}).catchError((Object _) {}));
}

/// Asks the user for a spreadsheet or a backup file.
///
/// On Windows this is the system's own file dialogue. Cancellation returns
/// null - the normal way to change one's mind - and only a real failure to
/// read the chosen file throws.
Future<PickedFile?> pickFile({List<String> extensions = const []}) async {
  if (!Platform.isWindows) {
    throw UnsupportedError(
      'Choosing a file needs the web build on this platform. On Windows the '
      'desktop program opens the system file dialogue.',
    );
  }

  // One PowerShell command for the system file dialogue: the desktop program
  // ships no extra package for it, and a real dialogue is what people expect.
  final filter = extensions.isEmpty
      ? 'All files (*.*)|*.*'
      : 'Files (${extensions.join(';')})|${extensions.join(';')}|All files (*.*)|*.*';
  final script = 'Add-Type -AssemblyName System.Windows.Forms\n'
      r'$dialog = New-Object System.Windows.Forms.OpenFileDialog' '\n'
      r'$dialog.Multiselect = $false' '\n'
      "\$dialog.Filter = '${filter.replaceAll("'", "''")}'\n"
      r'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) '
      r'{ [Console]::Out.Write($dialog.FileName) }';

  final result = await Process.run('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ]);
  if (result.exitCode != 0) {
    throw StateError(
      'The file dialogue could not be opened: ${result.stderr}'.trim(),
    );
  }
  final path = ('${result.stdout}').trim();
  if (path.isEmpty) return null; // the dialogue was closed without a choice

  final file = File(path);
  if (!await file.exists()) {
    throw StateError('The chosen file is gone: $path');
  }
  final bytes = await file.readAsBytes();
  final name = path.split(Platform.pathSeparator).last;
  return PickedFile(
    name: name,
    bytes: Uint8List.fromList(bytes),
    mimeType: 'application/octet-stream',
  );
}
