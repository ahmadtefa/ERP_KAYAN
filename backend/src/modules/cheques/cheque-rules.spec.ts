import { ChequeAction, ChequeDirection, ChequeMoveError, ChequeStatus, CHEQUE_STATUSES, isOpenCheque, nextChequeStatus } from './cheque-rules';

const ACTIONS: ChequeAction[] = ['deposit', 'collect', 'bounce', 'cancel', 'represent'];

describe('cheque life cycle', () => {
  it('a received cheque goes held, deposited, collected', () => {
    expect(nextChequeStatus('RECEIVED', 'HELD', 'deposit')).toBe('DEPOSITED');
    expect(nextChequeStatus('RECEIVED', 'DEPOSITED', 'collect')).toBe('COLLECTED');
  });
  it('a received cheque cannot be collected before it is deposited', () => {
    expect(() => nextChequeStatus('RECEIVED', 'HELD', 'collect')).toThrow(ChequeMoveError);
  });
  it('a bounced received cheque can be presented again or cancelled', () => {
    expect(nextChequeStatus('RECEIVED', 'BOUNCED', 'represent')).toBe('DEPOSITED');
    expect(nextChequeStatus('RECEIVED', 'BOUNCED', 'cancel')).toBe('CANCELLED');
  });
  it('an issued cheque is held, then cleared, with no deposit step', () => {
    expect(nextChequeStatus('ISSUED', 'HELD', 'collect')).toBe('COLLECTED');
    expect(() => nextChequeStatus('ISSUED', 'HELD', 'deposit')).toThrow(/cannot be deposited/);
    expect(nextChequeStatus('ISSUED', 'BOUNCED', 'represent')).toBe('HELD');
  });
  it('a collected or cancelled cheque is final, in both directions', () => {
    for (const direction of ['RECEIVED', 'ISSUED'] as ChequeDirection[]) {
      for (const status of ['COLLECTED', 'CANCELLED'] as ChequeStatus[]) {
        for (const action of ACTIONS) {
          expect(() => nextChequeStatus(direction, status, action)).toThrow(ChequeMoveError);
        }
      }
    }
  });
  it('every move lands on a known status', () => {
    for (const direction of ['RECEIVED', 'ISSUED'] as ChequeDirection[]) {
      for (const status of CHEQUE_STATUSES) {
        for (const action of ACTIONS) {
          try {
            expect(CHEQUE_STATUSES).toContain(nextChequeStatus(direction, status, action));
          } catch (e) {
            expect(e).toBeInstanceOf(ChequeMoveError);
          }
        }
      }
    }
  });
  it('only held and deposited cheques are open', () => {
    expect(CHEQUE_STATUSES.filter(isOpenCheque)).toEqual(['HELD', 'DEPOSITED']);
  });
});
