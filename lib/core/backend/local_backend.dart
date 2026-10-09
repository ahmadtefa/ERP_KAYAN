/// Chooses how the program talks to its API server, depending on what it was
/// built for.
///
/// A desktop copy owns its server: it starts one, waits for it and stops it.
/// A browser tab cannot do any of that, so the web build gets a stub that
/// reports "there is nothing to start here" and the program keeps using the
/// server it is already talking to, exactly as before.
///
/// Nothing else in the program needs to know which build it is in: both
/// implementations have the same shape.
library;

export 'local_backend_stub.dart'
    if (dart.library.io) 'local_backend_io.dart';
