import 'dart:async';
import 'dart:convert' as convert;
import 'dart:typed_data';
// The browser's own API, used on purpose: a file the user chooses, a tab
// opened for a print page and a file handed to the browser's download
// handling are things only the page itself can do. This file is compiled for
// the web build and nothing else - see browser_actions.dart.
// ignore: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:html' as html;

import 'download_request.dart';
import 'picked_file.dart';

/// Fetches the file behind [request] and hands the bytes to the browser.
///
/// The bytes come back through a request rather than a navigation so that a
/// refusal is a refusal and not a blank tab: when the server answers with an
/// error the future throws [DownloadFailure] carrying the server's own
/// sentence, and the screen shows it instead of claiming success.
///
/// The file is then saved from an object URL, which is what lets an Arabic
/// file name survive the trip - a plain navigation would use whatever the
/// address ends with.
///
/// A refusal the browser raises before the server answers at all (a page
/// served from an origin the server does not answer) cannot be read, so the
/// address is handed to the browser as a navigation instead, where the
/// browser's own download handling takes over.
Future<void> downloadFile(DownloadRequest request) async {
  try {
    await _fetchAndSave(request);
  } on DownloadFailure {
    rethrow;
  } catch (error) {
    // Nothing came back to inspect: let the browser fetch the address
    // itself. A navigation is not subject to the page's own origin rules.
    _navigateAndDownload(request.url);
    if (error is StateError) rethrow;
  }
}

Future<void> _fetchAndSave(DownloadRequest request) async {
  final html.HttpRequest response = await html.HttpRequest.request(
    request.url,
    method: 'GET',
    responseType: 'arraybuffer',
    // The address carries its own one-minute ticket; nothing else is needed.
    withCredentials: false,
  );

  final status = response.status ?? 0;
  final bytes = _bytesOf(response.response);
  if (status < 200 || status >= 300) {
    throw DownloadFailure(_reasonFrom(bytes, status), statusCode: status);
  }
  if (bytes == null) {
    throw DownloadFailure(
      'The server sent no file. Ask the person who looks after the program '
      'to check its logs.',
      statusCode: status,
    );
  }

  final name = request.fileName ?? _nameFromHeader(response) ?? _nameFromUrl(request.url);
  final blob = html.Blob(<Object>[bytes]);
  final objectUrl = html.Url.createObjectUrlFromBlob(blob);
  final anchor = html.AnchorElement(href: objectUrl)
    ..setAttribute('download', name)
    ..style.display = 'none';

  // The address has to be followed inside the gesture that started this, so
  // the element is clicked while it is attached and then taken away again.
  // Removing it too early cancels the download in some browsers, hence the
  // moment's grace; the object URL is released the same way, because a
  // revoked URL is an unreadable one.
  html.document.body?.append(anchor);
  anchor.click();
  Timer(const Duration(seconds: 5), () {
    anchor.remove();
    html.Url.revokeObjectUrl(objectUrl);
  });
}

/// A download started by navigating a hidden frame. The browser's own
/// download handling takes it from here, and no popup is involved.
void _navigateAndDownload(String url) {
  final frame = html.IFrameElement()
    ..setAttribute('aria-hidden', 'true')
    ..style.border = '0'
    ..style.width = '1px'
    ..style.height = '1px'
    ..style.position = 'fixed'
    ..style.left = '-9999px'
    ..src = url;
  html.document.body?.append(frame);
  // The frame must stay until the browser has taken the download over;
  // after ten minutes it is safe to drop.
  Timer(const Duration(minutes: 10), frame.remove);
}

/// The server's own explanation, when it sent one.
///
/// Errors come back as RFC 9457 problem details with a `detail` field; a
/// file that was never a report has no such field, so the status stands on
/// its own rather than being replaced by something vague.
String _reasonFrom(Uint8List? bytes, int status) {
  if (bytes == null || bytes.isEmpty) {
    return 'The server would not send the file (HTTP $status).';
  }
  String text;
  try {
    text = convert.utf8.decode(bytes, allowMalformed: true);
  } catch (_) {
    return 'The server would not send the file (HTTP $status).';
  }
  try {
    final decoded = convert.jsonDecode(text);
    if (decoded is Map && decoded['detail'] is String) {
      return decoded['detail'] as String;
    }
  } catch (_) {
    // Not JSON: fall through to the plain text.
  }
  final trimmed = text.trim();
  return trimmed.isEmpty
      ? 'The server would not send the file (HTTP $status).'
      : trimmed;
}

/// Whatever shape the platform hands back from an `arraybuffer` request.
Uint8List? _bytesOf(Object? response) {
  if (response == null) return null;
  if (response is Uint8List) return response;
  if (response is ByteBuffer) return response.asUint8List();
  if (response is List<int>) return Uint8List.fromList(response);
  return null;
}

/// The file name the server asks for, including the Arabic ones.
///
/// `filename*=UTF-8''%D9%85...` (RFC 5987) comes first, because that is the
/// only form that can carry Arabic at all; the plain `filename="..."` that
/// follows is the same name reduced to Latin characters by older servers.
String? _nameFromHeader(html.HttpRequest response) {
  final header = response.getResponseHeader('content-disposition');
  if (header == null || header.isEmpty) return null;

  final encoded = RegExp(
    r"filename\*\s*=\s*([^']*)''([^;]+)",
    caseSensitive: false,
  ).firstMatch(header);
  if (encoded != null) {
    final raw = encoded.group(2)!.trim().replaceAll('"', '');
    try {
      final decoded = Uri.decodeComponent(raw);
      if (decoded.isNotEmpty) return _safe(decoded);
    } catch (_) {
      // A name that will not decode is no name; the plain one may still work.
    }
  }

  final plain = RegExp(
    r'filename\s*=\s*"([^"]+)"',
    caseSensitive: false,
  ).firstMatch(header);
  if (plain != null) return _safe(plain.group(1)!);

  final bare = RegExp(
    r'filename\s*=\s*([^;]+)',
    caseSensitive: false,
  ).firstMatch(header);
  if (bare != null) return _safe(bare.group(1)!.trim().replaceAll('"', ''));
  return null;
}

/// Strips anything that is not a file name: a path in a header is either a
/// mistake or an attempt, and neither belongs in a save dialogue.
String _safe(String name) {
  final cleaned = name
      .split(RegExp(r'[\\/]'))
      .last
      .replaceAll(RegExp(r'[\u0000-\u001f]'), '')
      .trim();
  return cleaned.isEmpty ? 'download' : cleaned;
}

String _nameFromUrl(String url) {
  final path = Uri.tryParse(url)?.pathSegments;
  if (path == null || path.isEmpty || path.last.isEmpty) return 'download';
  return _safe(path.last);
}

/// Opens [url] in a new tab. The browser keeps or prints what the server
/// sends.
///
/// Used for the print page: a new tab is what lets the person look at the
/// page before printing it. Where a new tab is refused - a popup blocker, or
/// a page running inside a sandboxed frame such as a preview embed - the
/// page is printed from a hidden frame instead, so the button still produces
/// a printout rather than doing nothing. In that fallback the page is asked
/// to auto-print, because there is no tab for anyone to look at first.
void openInNewTab(String url) {
  // The declared return type of window.open is not nullable, but the browser
  // returns null when it refuses the tab - hence the dynamic, which is the
  // only honest way to ask "was a tab opened?".
  final dynamic tab = html.window.open(url, '_blank');
  if (tab != null) return;
  _printFromHiddenFrame(_withAutoPrint(url));
}

/// The same page, told to open the print dialogue by itself.
///
/// Only meaningful for the print routes; any other URL simply ignores the
/// parameter.
String _withAutoPrint(String url) {
  try {
    final uri = Uri.parse(url);
    if (!uri.path.contains('/print')) return url;
    return uri.replace(queryParameters: {...uri.queryParameters, 'auto': '1'}).toString();
  } catch (_) {
    return url;
  }
}

void _printFromHiddenFrame(String url) {
  final frame = html.IFrameElement()
    ..setAttribute('aria-hidden', 'true')
    ..style.border = '0'
    // Not display:none: a frame that is not laid out prints blank. Offscreen
    // but laid out is what the print-from-frame technique needs.
    ..style.position = 'fixed'
    ..style.left = '-10000px'
    ..style.width = '1100px'
    ..style.height = '1400px'
    ..src = url;
  html.document.body?.append(frame);
  frame.onLoad.listen((_) {
    // The print page calls window.print() by itself once loaded with auto=1.
    // For anything else that lands here, print what arrived - a call across
    // origins can be refused, which is fine: the frame did what it could.
    Timer(const Duration(milliseconds: 300), () {
      // window.print() across frames: the type of a frame's window does not
      // carry print(), so the call goes through - which is what the browser
      // understands, and what is refused across origins can be caught.
      final dynamic window = frame.contentWindow;
      if (window == null) return;
      try {
        window.print();
      } catch (_) {
        /* cross-origin or already printed: nothing more to do */
      }
    });
    Timer(const Duration(minutes: 10), frame.remove);
  });
}

/// Asks the user for a file and reads it.
///
/// Returns null when the dialogue is closed without choosing anything, which
/// is a normal thing to do and not an error. Throws [StateError] only when a
/// chosen file could not be read.
Future<PickedFile?> pickFile({List<String> extensions = const []}) async {
  final input = html.FileUploadInputElement();
  if (extensions.isNotEmpty) {
    input.accept = extensions.join(',');
  }
  // Attached to the page: some browsers ignore the click on an element that
  // is not in the document.
  input.style.display = 'none';
  html.document.body?.append(input);

  final completer = Completer<PickedFile?>();
  var finished = false;
  StreamSubscription<html.Event>? focusSubscription;

  void finish(PickedFile? file) {
    if (finished) return;
    finished = true;
    focusSubscription?.cancel();
    input.remove();
    completer.complete(file);
  }

  void fail(Object error) {
    if (finished) return;
    finished = true;
    focusSubscription?.cancel();
    input.remove();
    completer.completeError(error);
  }

  input.onChange.listen((_) {
    final files = input.files;
    if (files == null || files.isEmpty) {
      // 'change' with no file is the dialogue closing without a choice.
      finish(null);
      return;
    }
    final file = files.first;
    final reader = html.FileReader();
    reader.onLoad.listen((_) {
      try {
        final bytes = _pickedBytes(reader.result);
        finish(
          PickedFile(
            name: file.name,
            bytes: bytes,
            mimeType: file.type.isEmpty ? 'application/octet-stream' : file.type,
          ),
        );
      } catch (error) {
        fail(StateError('The file could not be read: ${file.name} ($error)'));
      }
    });
    reader.onError.listen((_) {
      fail(StateError('The file could not be read: ${file.name}'));
    });
    reader.readAsArrayBuffer(file);
  });

  // Closing the dialogue without choosing fires 'cancel' in current
  // browsers. Older ones fire nothing at all - for those the window taking
  // focus again, with no file on the input, means the same thing. Both paths
  // end with null; a second attempt to finish is ignored.
  input.addEventListener('cancel', (_) => finish(null));
  input.addEventListener('change', (_) {
    if (input.files == null || input.files!.isEmpty) finish(null);
  });
  focusSubscription = html.window.onFocus.listen((_) {
    Timer(const Duration(milliseconds: 300), () {
      if (!finished && (input.files == null || input.files!.isEmpty)) {
        finish(null);
      }
    });
  });

  try {
    input.click();
  } catch (error) {
    fail(StateError('The file dialogue could not be opened: $error'));
  }
  return completer.future;
}

/// Whatever shape the platform hands back after `readAsArrayBuffer`.
Uint8List _pickedBytes(Object? result) {
  if (result is Uint8List) return result;
  if (result is ByteBuffer) return result.asUint8List();
  if (result is List<int>) return Uint8List.fromList(result);
  throw StateError('unexpected file data (${result.runtimeType})');
}
