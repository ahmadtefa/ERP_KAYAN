import { orderCreationIdentity } from './order-creation-identity';

describe('order creation retry identity', () => {
  it('keeps legacy requests optional but rejects invalid supplied keys', () => {
    expect(orderCreationIdentity({ lines: [] })).toBeNull();
    for (const idempotencyKey of [null, '', 'short', 'a'.repeat(129), 'unsafe spaces 0000']) {
      expect(() => orderCreationIdentity({ idempotencyKey })).toThrow();
    }
  });
  it('canonicalizes object keys but detects changed payload and line order', () => {
    const idempotencyKey = 'synthetic-order-create-001';
    const one = orderCreationIdentity({ idempotencyKey, party: 'p', lines: [{ quantity: '1', itemId: 'i' }] });
    const same = orderCreationIdentity({ lines: [{ itemId: 'i', quantity: '1' }], party: 'p', idempotencyKey });
    const changed = orderCreationIdentity({ idempotencyKey, party: 'p', lines: [{ quantity: '2', itemId: 'i' }] });
    expect(one).toEqual(same);
    expect(one?.hash).not.toEqual(changed?.hash);
    expect(orderCreationIdentity({ idempotencyKey, lines: [1, 2] })?.hash)
      .not.toEqual(orderCreationIdentity({ idempotencyKey, lines: [2, 1] })?.hash);
  });
});
