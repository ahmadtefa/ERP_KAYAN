/// What the program asks the browser to do on the user's behalf.
///
/// Three things a page cannot do from Dart alone:
///
///  * save a file the server sends as an attachment (`downloadFile`);
///  * open a page meant to be printed (`openInNewTab`);
///  * read a file the user chooses (`pickFile`).
///
/// All three have to go through the platform, so this picks the right
/// implementation when the program is compiled. The web build talks to the
/// browser's own APIs; any other target hands URLs to the machine's default
/// browser and uses the system file dialogue, so a button that is clicked
/// does something rather than failing silently.
///
/// `downloadFile` returns a future that completes only once the file has
/// been handed over, and throws [DownloadFailure] when the server would not
/// send it - no screen may claim success before that.
library;

export 'download_request.dart';
export 'browser_actions_stub.dart'
    if (dart.library.html) 'browser_actions_web.dart';
