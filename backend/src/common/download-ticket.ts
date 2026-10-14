/// The short-lived credential that may travel in a web address.
///
/// A print page opened in a new tab is a navigation, and a navigation cannot
/// carry an Authorization header. Something therefore has to be in the
/// address, and the sign-in token is the wrong thing to put there: it lives
/// for a quarter of an hour, it works on every route this person can reach,
/// and an address ends up in browser history, in proxy logs and in the
/// Referer header of anything the page links to.
///
/// A ticket is minted for one file and one minute, is spent as a navigation
/// and nowhere else, and cannot be exchanged for anything but the bytes it
/// was minted for. It is signed with the same secret as the sign-in token, so
/// losing the secret does not create a second thing to protect.
export const DOWNLOAD_TICKET_TYPE = 'download';

/// How long a ticket stays good, in seconds. Long enough for the browser to
/// follow the address after the button was pressed, short enough that an old
/// address in a history entry is dead before anyone thinks to reuse it.
export const DOWNLOAD_TICKET_TTL_SECONDS = 60;

export function downloadTicketTtl(): number {
  const configured = Number(process.env.JWT_DOWNLOAD_TICKET_TTL);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 600)
    : DOWNLOAD_TICKET_TTL_SECONDS;
}
