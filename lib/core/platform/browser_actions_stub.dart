import 'picked_file.dart';

/// Used when the program is built for something that is not a browser.
///
/// The interface says so plainly instead of doing nothing, so a button that
/// cannot work never looks like it did.
Never _needsBrowser() {
  throw UnsupportedError(
    'This build cannot do that: opening a download and choosing a file need a '
    'browser. Open the web build, or download the file from the API directly.',
  );
}

/// Opens [url] in a new tab. The browser keeps or prints what the server sends.
void openInNewTab(String url) => _needsBrowser();

/// Asks the user for a spreadsheet or a backup file.
Future<PickedFile?> pickFile({List<String> extensions = const []}) async {
  _needsBrowser();
}
