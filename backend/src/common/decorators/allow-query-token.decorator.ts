import { SetMetadata } from '@nestjs/common';

export const ALLOW_QUERY_TOKEN_KEY = 'allowQueryToken';

/// Lets a route accept a one-minute download ticket as `?ticket=` instead of a
/// bearer header.
///
/// A file download is a browser navigation, not an XHR: the browser opens a
/// tab and the tab cannot carry an Authorization header. Without this the only
/// way to download a report would be to fetch its bytes into memory and hand
/// them to the page as a blob, which fails on large files.
///
/// Apply it to download and print routes only, and never to a route that
/// changes data. The ticket is minted by `POST /auth/download-ticket`, works
/// on these routes alone, and dies after a minute; a sign-in token is refused
/// here even though it would verify, because a quarter-hour credential in a
/// URL can be replayed against the whole API.
export const AllowQueryToken = () => SetMetadata(ALLOW_QUERY_TOKEN_KEY, true);
