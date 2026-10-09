import { SetMetadata } from '@nestjs/common';

export const ALLOW_QUERY_TOKEN_KEY = 'allowQueryToken';

/// Lets a route accept the access token as `?token=` instead of a bearer
/// header.
///
/// A file download is a browser navigation, not an XHR: the browser opens a
/// tab and the tab cannot carry an Authorization header. Without this the only
/// way to download a report would be to fetch its bytes into memory and hand
/// them to the page as a blob, which fails on large files.
///
/// Apply it to download and print routes only, and never to a route that
/// changes data: a token in a URL can end up in a browser history entry or a
/// server log, which is acceptable for a file that is already the user's own
/// report and not for anything else.
export const AllowQueryToken = () => SetMetadata(ALLOW_QUERY_TOKEN_KEY, true);
