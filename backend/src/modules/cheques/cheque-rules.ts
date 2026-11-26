/** The cheque life cycle, kept pure so every move is testable without a database. */
export type ChequeDirection = 'RECEIVED' | 'ISSUED';
export type ChequeStatus = 'HELD' | 'DEPOSITED' | 'COLLECTED' | 'BOUNCED' | 'CANCELLED';
export type ChequeAction = 'deposit' | 'collect' | 'bounce' | 'cancel' | 'represent';

export const CHEQUE_STATUSES: ChequeStatus[] = ['HELD', 'DEPOSITED', 'COLLECTED', 'BOUNCED', 'CANCELLED'];

const MOVES: Record<ChequeDirection, Record<ChequeAction, { from: ChequeStatus[]; to: ChequeStatus }>> = {
  RECEIVED: {
    // Taken to the bank for collection.
    deposit: { from: ['HELD'], to: 'DEPOSITED' },
    // The bank confirmed the money: this is the only move that books it.
    collect: { from: ['DEPOSITED'], to: 'COLLECTED' },
    bounce: { from: ['HELD', 'DEPOSITED'], to: 'BOUNCED' },
    // A returned cheque is presented again.
    represent: { from: ['BOUNCED'], to: 'DEPOSITED' },
    cancel: { from: ['HELD', 'BOUNCED'], to: 'CANCELLED' },
  },
  ISSUED: {
    // An issued cheque has no deposit step.
    deposit: { from: [], to: 'DEPOSITED' },
    // Cleared by our bank: this is the only move that books it.
    collect: { from: ['HELD'], to: 'COLLECTED' },
    bounce: { from: ['HELD'], to: 'BOUNCED' },
    represent: { from: ['BOUNCED'], to: 'HELD' },
    cancel: { from: ['HELD', 'BOUNCED'], to: 'CANCELLED' },
  },
};

export class ChequeMoveError extends Error {}

export function nextChequeStatus(direction: ChequeDirection, status: ChequeStatus, action: ChequeAction): ChequeStatus {
  const move = MOVES[direction][action];
  if (!move || !move.from.includes(status)) {
    throw new ChequeMoveError(
      `A ${direction === 'RECEIVED' ? 'received' : 'issued'} cheque that is ${status.toLowerCase()} cannot be ${verb(action)}`,
    );
  }
  return move.to;
}

function verb(action: ChequeAction): string {
  return { deposit: 'deposited', collect: 'marked collected', bounce: 'marked bounced', cancel: 'cancelled', represent: 'presented again' }[action];
}

/** Statuses a cheque may still leave, so a list can show what needs attention. */
export function isOpenCheque(status: ChequeStatus): boolean {
  return status === 'HELD' || status === 'DEPOSITED';
}
