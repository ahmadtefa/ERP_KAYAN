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
