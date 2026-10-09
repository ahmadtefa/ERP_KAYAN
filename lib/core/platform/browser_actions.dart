/// What the program asks the browser to do on the user's behalf.
///
/// Two things a page cannot do from Dart alone: open a URL in a new tab (a
/// report download, a print page) and read a file the user chooses. Both have
/// to go through the platform, so this picks the right implementation when the
/// program is compiled.
///
/// Web uses browser APIs; native desktop builds use platform file pickers and
/// the user's default browser.
library;

export 'browser_actions_stub.dart'
    if (dart.library.html) 'browser_actions_web.dart'
    if (dart.library.io) 'browser_actions_io.dart';
