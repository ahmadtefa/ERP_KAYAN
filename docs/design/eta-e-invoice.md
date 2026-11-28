# Egyptian e-invoice (ETA) integration: design only

Status: design only. No code, no credentials, no live submission. Anything marked VERIFY must be
confirmed from the Egyptian Tax Authority's official developer documentation before it is built.

## Goal
A posted sales invoice, credit note or debit note can be sent to the ETA, and the program keeps the
ETA's answer (accepted, rejected with reasons, cancelled) next to the document.

## Principles
- Off by default. A company turns it on only after it has entered its own ETA credentials.
- The program never builds the signed document from guesses: every mandatory ETA field is a typed
  setting or a field of the invoice, and a document with a missing field is refused before sending
  with a message that says which field.
- Sending never changes the ledger. The ETA status is a separate record linked to the invoice.
- Credentials and the signing certificate never sit in the repository, in logs or in chat. The
  certificate and PIN are stored through the same protected store the licence keys use (decision
  pending the user's go-ahead); the app only ever shows "saved" or "missing".
- Test against the ETA pre-production environment first, with synthetic data only.

## Data the program must hold (VERIFY the exact list)
- Company: tax registration number, activity code, branch code, address block.
- Customer: type (business, person, foreign), tax number or national ID where required by the
  document value rule, address.
- Item: item code type and code (EGS or GS1), unit type code from the ETA list, tax type and
  sub-type codes.
- Document: internal number, date and time, document type version, lines with unit value, quantity,
  discount, tax lines, totals, and for credit/debit notes the reference to the original document's
  ETA UUID.

## Flow
1. Prepare: build the ETA JSON from the posted invoice. Show it as a preview with a list of
   missing or invalid fields.
2. Sign: sign with the company's certificate (VERIFY: signing method and canonical form).
3. Submit: POST to the ETA documents endpoint using a short-lived token from the identity endpoint.
4. Track: store submission id, document UUID, long id, status, and any rejection reasons. A queue
   polls status; a user can retry or fix and resend.
5. Cancel/return: cancel within the ETA's allowed window, or issue a credit note.

## Tables (planned)
- `eta_settings` (per company): environment, client id, flags; secrets only in the protected store.
- `eta_submissions`: invoice id, payload hash, submission id, uuid, status, errors, timestamps.
- `eta_code_maps`: item and unit code mappings.

## Permissions (planned, explicit-only)
`eta.settings.manage`, `eta.submit`, `eta.read`. Separation of duties: the person who changes
credentials cannot be the only person who submits.

## Error messages
Reviewed bilingual templates for each ETA rejection class (validation, duplicate, token, network,
window expired), Arabic first, with what happened and how to fix it. The server body is never shown.

## Open items that need the user (not decided here)
- Which ETA environment credentials and when they will be supplied.
- Where the signing certificate is held (token device or file); no key location is asked in chat.
