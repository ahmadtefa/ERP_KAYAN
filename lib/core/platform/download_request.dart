import 'dart:typed_data';

/// What the platform needs to fetch a file the server is holding.
///
/// The address carries a one-minute download ticket (see
/// `ReportLinkBuilder`): a browser navigation cannot send an
/// Authorization header, and the sign-in token must not travel in an
/// address. The name is what the server says the file is called, used when
/// the page is the one doing the saving.
class DownloadRequest {
  const DownloadRequest({required this.url, this.fileName});

  final String url;

  /// Optional: the server's own name for the file. When it is absent the
  /// platform takes the name from the `Content-Disposition` header, and
  /// falls back to the last part of the address.
  final String? fileName;
}

/// Refuses bytes that are not the file their name claims they are.
///
/// A download can come back with a success status and still not be a file:
/// an address that misses every API route is answered by the web app's own
/// page, and saving that page as `report.pdf` or `template.xlsx` leaves the
/// person with a corrupt file and a success message. The first bytes of a
/// real PDF (`%PDF-`) and of a real spreadsheet (a ZIP, `PK`) are fixed, so
/// they are checked before anything is saved; anything else is reported
/// as the failure it is instead of being written to disk.
void validateDownloadedFile(Uint8List bytes, String fileName) {
  if (bytes.isEmpty) {
    throw const DownloadFailure(
      'The server sent an empty file, so nothing was saved.',
    );
  }
  bool startsWith(List<int> magic) {
    if (bytes.length < magic.length) return false;
    for (var index = 0; index < magic.length; index += 1) {
      if (bytes[index] != magic[index]) return false;
    }
    return true;
  }

  final name = fileName.toLowerCase();
  // %PDF-
  if (name.endsWith('.pdf') &&
      !startsWith(const [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw const DownloadFailure(
      'The server did not send a real PDF file, so nothing was saved. '
      'Try again; if it keeps happening, the server logs will say why.',
    );
  }
  // PK\x03\x04 - every .xlsx is a ZIP, and so is every .zip.
  if ((name.endsWith('.xlsx') || name.endsWith('.zip')) &&
      !startsWith(const [0x50, 0x4b, 0x03, 0x04])) {
    throw const DownloadFailure(
      'The server did not send a real spreadsheet file, so nothing was '
      'saved. Try again; if it keeps happening, the server logs will '
      'say why.',
    );
  }
}

/// Thrown when the server answers a download with something other than a
/// file: a refusal, a missing report, or a broken machine. The message is
/// the server's own, so it can be shown as it is.
class DownloadFailure implements Exception {
  const DownloadFailure(this.message, {this.statusCode});

  /// A sentence a person can act on, already localised by the server.
  final String message;

  final int? statusCode;

  @override
  String toString() => statusCode == null ? message : '$statusCode: $message';
}
