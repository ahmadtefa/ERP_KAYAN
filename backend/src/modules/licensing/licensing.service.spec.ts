import { generateKeyPairSync } from 'node:crypto';

import { loadPublicKey, signPayload, verifyKey } from './license-key';
import {
  LICENSE,
  MACHINE,
  OTHER_MACHINE,
  PUBLIC_PEM,
  SECOND_LICENSE,
  activation,
  expectCode,
  harness,
  renewal,
  seatsKey,
  transferKey,
} from './licensing.harness';

describe('readiness', () => {
  it('tries again after a startup that could not read the database', async () => {
    const h = harness();
    try {
      const original = h.db.licenseInstallation.findFirst;
      let calls = 0;
      (h.db.licenseInstallation as any).findFirst = async () => {
        calls += 1;
        if (calls <= 1) throw new Error('the database is not up yet');
        return original();
      };
      await expect(h.service.status()).rejects.toThrow(/not up yet/);
      const status = await h.service.status();
      expect(status.state).toBe('UNLICENSED');
    } finally {
      h.dispose();
    }
  });
});

describe('before activation', () => {
  it('reports an unlicensed installation and blocks business use under enforce', async () => {
    const h = harness();
    try {
      const status = await h.service.status();
      expect(status.state).toBe('UNLICENSED');
      expect(status.blocked).toBe(true);
      expect(status.seats).toEqual({ limit: 0, used: 0, available: null });
      expect(status.machineId).toBe(MACHINE);
      expect(status.requestCode.startsWith('KYNREQ1.')).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it('lets the installation run when enforcement is off', async () => {
    const h = harness({ enforcement: 'off' });
    try {
      expect((await h.service.status()).blocked).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it('refuses a renewal or a seats key with no licence to change', async () => {
    const h = harness();
    try {
      await expectCode(renewal(h), 'LICENSE_NOT_INSTALLED');
      await expectCode(seatsKey(h), 'LICENSE_NOT_INSTALLED');
      expect(h.db.installations).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });
});

describe('activation', () => {
  it('installs a one-year licence that ends a calendar year later', async () => {
    const h = harness();
    try {
      const status = await activation(h);
      expect(status.state).toBe('ACTIVE');
      expect(status.blocked).toBe(false);
      expect(status.expiresAt).toBe('2027-05-01T09:00:00.000Z');
      expect(status.seats).toEqual({ limit: 5, used: 0, available: 5 });
      expect(status.perpetual).toBe(false);
      expect(h.db.keys).toHaveLength(1);
      expect(h.store.current.appliedKeys).toEqual(['key_activation-1']);
    } finally {
      h.dispose();
    }
  });

  it('retains the original verified signature in the key transaction', async () => {
    const h = harness();
    try {
      const signed = h.key({});
      await h.service.activate(signed);
      const record = h.db.keys[0];
      expect(record.signedKey).toBe(signed);
      const proof = verifyKey(record.signedKey, loadPublicKey(PUBLIC_PEM));
      expect(proof.payload.keyId).toBe(record.keyId);
      expect(proof.payloadJson).toBe(record.payloadJson);
    } finally {
      h.dispose();
    }
  });

  it('refuses a key issued for another computer, and installs nothing', async () => {
    const h = harness();
    try {
      await expectCode(
        activation(h, { machineId: OTHER_MACHINE }),
        'LICENSE_KEY_WRONG_MACHINE',
      );
      expect(h.db.installations).toHaveLength(0);
      expect(h.store.current.appliedKeys).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it('refuses a second activation instead of replacing the licence', async () => {
    const h = harness();
    try {
      await activation(h);
      await expectCode(
        activation(h, { keyId: 'key_activation-2', licenseId: SECOND_LICENSE }),
        'LICENSE_ALREADY_ACTIVE',
      );
      expect(h.db.installations).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  it('refuses a key whose signature is not the operator’s', async () => {
    const h = harness();
    try {
      const stranger = generateKeyPairSync('ed25519');
      const forged = signPayload(
        {
          v: 1,
          keyId: 'key_forged-1',
          type: 'ACTIVATION',
          licenseId: LICENSE,
          machineId: MACHINE,
          issuedAt: '2026-04-30T00:00:00.000Z',
          term: { kind: 'PERPETUAL' },
          seats: { mode: 'CAP', value: 1000 },
          state: null,
        },
        stranger.privateKey,
      );
      await expectCode(h.service.activate(forged), 'LICENSE_KEY_BAD_SIGNATURE');
      expect(h.db.installations).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it('cannot be performed with a renewal, seats or transfer key', async () => {
    const h = harness();
    try {
      await expectCode(
        h.service.activate(h.key({ type: 'SEATS', term: null, machineId: null })),
        'LICENSE_KEY_WRONG_TYPE',
      );
      await expectCode(
        h.service.activate(
          h.key({ type: 'RENEWAL', machineId: null, seats: null }),
        ),
        'LICENSE_KEY_WRONG_TYPE',
      );
      expect(h.db.installations).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it('adopts the accounts that existed before the licence instead of freeing them', async () => {
    const h = harness();
    try {
      // What the migration writes for users that already existed.
      for (const index of [1, 2, 3]) {
        h.db.seats.push({
          licenseId: null,
          userId: `user-${index}`,
          username: `user${index}`,
          reason: 'MIGRATION_EXISTING',
          idempotencyKey: `migration:user-${index}`,
          createdAt: new Date(),
        });
      }
      const status = await activation(h);
      expect(status.seats).toEqual({ limit: 5, used: 3, available: 2 });
      expect(h.db.seats.every((row) => row.licenseId === LICENSE)).toBe(true);
      expect(h.db.seats).toHaveLength(3);
    } finally {
      h.dispose();
    }
  });
});

describe('perpetual licences', () => {
  it('never expire, and are never treated as expired years later', async () => {
    const h = harness();
    try {
      const status = await activation(h, { term: { kind: 'PERPETUAL' } });
      expect(status.perpetual).toBe(true);
      expect(status.expiresAt).toBeNull();
      expect(status.daysRemaining).toBeNull();

      h.setNow('2045-01-01T00:00:00.000Z');
      const later = await h.service.status({ fresh: true });
      expect(later.state).toBe('ACTIVE');
      expect(later.blocked).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it('still enforces the seat limit', async () => {
    const h = harness();
    try {
      await activation(h, {
        term: { kind: 'PERPETUAL' },
        seats: { mode: 'CAP', value: 1 },
      });
      await h.service.reserveSeat(h.db as any, {
        userId: 'u1',
        username: 'first',
        reason: 'USER_CREATE',
      });
      await expectCode(
        h.service.reserveSeat(h.db as any, {
          userId: 'u2',
          username: 'second',
          reason: 'USER_CREATE',
        }),
        'LICENSE_SEATS_EXHAUSTED',
      );
    } finally {
      h.dispose();
    }
  });
});

describe('renewal', () => {
  it('adds the term to the end date when renewed before it expires', async () => {
    const h = harness();
    try {
      await activation(h);
      h.setNow('2027-01-01T09:00:00.000Z');
      const status = await renewal(h, { term: { kind: 'MONTHS', months: 6 } });
      expect(status.expiresAt).toBe('2027-11-01T09:00:00.000Z');
    } finally {
      h.dispose();
    }
  });

  it('starts from the day it is applied when the licence already expired', async () => {
    const h = harness();
    try {
      await activation(h);
      h.setNow('2027-08-01T09:00:00.000Z');
      const status = await renewal(h);
      // The gap between 2027-05-01 and 2027-08-01 is not back-filled.
      expect(status.expiresAt).toBe('2028-08-01T09:00:00.000Z');
      expect(status.state).toBe('ACTIVE');
    } finally {
      h.dispose();
    }
  });

  it('keeps a perpetual licence perpetual', async () => {
    const h = harness();
    try {
      await activation(h, { term: { kind: 'PERPETUAL' } });
      const status = await renewal(h);
      expect(status.perpetual).toBe(true);
      expect(status.expiresAt).toBeNull();
    } finally {
      h.dispose();
    }
  });

  it('does not change the seat limit or delete the accounts', async () => {
    const h = harness();
    try {
      await activation(h);
      h.db.users.push({ id: 'u1', createdAt: new Date('2026-05-02T00:00:00.000Z') });
      await h.service.reserveSeat(h.db as any, {
        userId: 'u1',
        username: 'accountant',
        reason: 'USER_CREATE',
      });
      const status = await renewal(h);
      expect(status.seats).toEqual({ limit: 5, used: 1, available: 4 });
      expect(h.db.seats).toHaveLength(1);
      expect(h.db.users).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  it('refuses a key that belongs to a different licence', async () => {
    const h = harness();
    try {
      await activation(h);
      await expectCode(
        renewal(h, { licenseId: SECOND_LICENSE }),
        'LICENSE_KEY_WRONG_LICENSE',
      );
    } finally {
      h.dispose();
    }
  });
});

describe('replay', () => {
  it('refuses the same key a second time', async () => {
    const h = harness();
    try {
      const key = h.key({});
      await h.service.activate(key);
      await expectCode(h.service.activate(key), 'LICENSE_KEY_ALREADY_USED');
      expect(h.db.installations).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  it('refuses a key the state file remembers even when the database row is gone', async () => {
    const h = harness();
    try {
      await activation(h);
      const before = (await h.service.status()).expiresAt;
      // Someone deletes the row that records the spent key (a restore, or a
      // deliberate edit). The protected state file still knows it.
      h.db.keys = [];
      await expectCode(
        renewal(h, { keyId: 'key_activation-1' }),
        'LICENSE_KEY_ALREADY_USED',
      );
      expect((await h.service.status({ fresh: true })).expiresAt).toBe(before);
    } finally {
      h.dispose();
    }
  });

  it('refuses an already spent activation even if an older database has no installation or key row', async () => {
    const h = harness();
    try {
      const key = h.key({});
      await h.service.activate(key);
      // Model an older restored database while preserving the independent trust state.
      h.db.installations = [];
      h.db.keys = [];
      await expectCode(h.service.activate(key), 'LICENSE_KEY_ALREADY_USED');
      expect(h.db.installations).toHaveLength(0);
      expect(h.db.keys).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it('imports historical database key IDs into independent state before a rollback', async () => {
    const h = harness();
    try {
      await h.service.status();
      const keyId = 'key_historical-01';
      const signed = h.key({ keyId });
      h.db.keys.push({ keyId }); // legacy row from before the 500-key fix
      await h.service.reconcile();
      expect(h.store.current.appliedKeys).toContain(keyId);
      h.db.keys = [];
      await expectCode(h.service.activate(signed), 'LICENSE_KEY_ALREADY_USED');
      expect(h.db.installations).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it('leaves no trace of a refused key, so the corrected key can be applied', async () => {
    const h = harness();
    try {
      await activation(h);
      await expectCode(
        seatsKey(h, { seats: { mode: 'CAP', value: 0 } }),
        'LICENSE_KEY_BAD_FIELD',
      );
      expect(h.db.keys).toHaveLength(1); // only the activation key
      const status = await seatsKey(h, { seats: { mode: 'INCREASE', value: 2 } });
      expect(status.seats.limit).toBe(7);
    } finally {
      h.dispose();
    }
  });
});

describe('seat increases', () => {
  it('raises the limit and leaves the term untouched', async () => {
    const h = harness();
    try {
      const activated = await activation(h, { term: { kind: 'PERPETUAL' } });
      const status = await seatsKey(h, { seats: { mode: 'INCREASE', value: 4 } });
      expect(status.seats.limit).toBe(9);
      expect(status.expiresAt).toBe(activated.expiresAt);
      expect(status.perpetual).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it('counts an INCREASE key from the current limit, not from the value', async () => {
    const h = harness();
    try {
      await activation(h, { seats: { mode: 'CAP', value: 10 } });
      const once = await seatsKey(h, { seats: { mode: 'INCREASE', value: 2 } });
      expect(once.seats.limit).toBe(12);
      const twice = await seatsKey(h, {
        keyId: 'key_seats-2',
        seats: { mode: 'INCREASE', value: 2 },
      });
      expect(twice.seats.limit).toBe(14);
    } finally {
      h.dispose();
    }
  });

  it('does not apply twice when the same key is entered again', async () => {
    const h = harness();
    try {
      await activation(h);
      const key = h.key({
        type: 'SEATS',
        keyId: 'key_seats-dup',
        machineId: null,
        term: null,
        seats: { mode: 'INCREASE', value: 3 },
      });
      await h.service.addSeats(key);
      await expectCode(h.service.addSeats(key), 'LICENSE_KEY_ALREADY_USED');
      expect((await h.service.status()).seats.limit).toBe(8);
    } finally {
      h.dispose();
    }
  });

  it('refuses a cap below the number of accounts already created', async () => {
    const h = harness();
    try {
      await activation(h);
      for (const index of [1, 2, 3]) {
        await h.service.reserveSeat(h.db as any, {
          userId: `u${index}`,
          username: `user${index}`,
          reason: 'USER_CREATE',
        });
      }
      await expectCode(
        seatsKey(h, { seats: { mode: 'CAP', value: 2 } }),
        'LICENSE_SEATS_BELOW_USED',
      );
      const status = await h.service.status({ fresh: true });
      expect(status.seats.limit).toBe(5);
      expect(status.seats.used).toBe(3);
    } finally {
      h.dispose();
    }
  });

  it('cannot be applied as a renewal, so a seat key never extends the term', async () => {
    const h = harness();
    try {
      await activation(h);
      await expectCode(
        h.service.renew(
          h.key({
            type: 'SEATS',
            keyId: 'key_seats-as-renewal',
            machineId: null,
            term: null,
            seats: { mode: 'INCREASE', value: 1 },
          }),
        ),
        'LICENSE_KEY_WRONG_TYPE',
      );
    } finally {
      h.dispose();
    }
  });
});

describe('seat ledger', () => {
  it('consumes a seat permanently: deleting the account does not return it', async () => {
    const h = harness();
    try {
      await activation(h, { seats: { mode: 'CAP', value: 2 } });
      const reserve = (userId: string) =>
        h.service.reserveSeat(h.db as any, {
          userId,
          username: userId,
          reason: 'USER_CREATE',
        });
      await reserve('u1');
      await reserve('u2');
      // The account is deleted from users; its seat-log row stays.
      h.db.users = [];
      await expectCode(reserve('u3'), 'LICENSE_SEATS_EXHAUSTED');
      expect((await h.service.status({ fresh: true })).seats).toEqual({
        limit: 2,
        used: 2,
        available: 0,
      });
    } finally {
      h.dispose();
    }
  });

  it('takes the advisory lock before counting, so parallel creations serialise', async () => {
    const h = harness();
    try {
      await activation(h);
      await h.service.reserveSeat(h.db as any, {
        userId: 'u1',
        username: 'u1',
        reason: 'USER_CREATE',
      });
      expect(h.db.clockLog[0]).toMatch(/pg_advisory_xact_lock/);
      expect(h.db.clockLog[0]).toContain('kayan.license.seats');
    } finally {
      h.dispose();
    }
  });

  it('treats a retried request with the same idempotency key as one seat', async () => {
    const h = harness();
    try {
      await activation(h, { seats: { mode: 'CAP', value: 5 } });
      const first = await h.service.reserveSeat(h.db as any, {
        userId: 'u1',
        username: 'u1',
        reason: 'USER_CREATE',
        idempotencyKey: 'req-123',
      });
      const retried = await h.service.reserveSeat(h.db as any, {
        userId: 'u1',
        username: 'u1',
        reason: 'USER_CREATE',
        idempotencyKey: 'req-123',
      });
      expect(first.reserved).toBe(true);
      expect(retried.alreadyApplied).toBe(true);
      expect(h.db.seats).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  it('trusts the protected watermark after a restore, not the restored rows', async () => {
    const h = harness();
    try {
      await activation(h, { seats: { mode: 'CAP', value: 5 } });
      for (const index of [1, 2, 3]) {
        await h.service.reserveSeat(h.db as any, {
          userId: `u${index}`,
          username: `u${index}`,
          reason: 'USER_CREATE',
        });
      }
      // A backup taken when only one account existed is restored.
      h.db.seats = h.db.seats.slice(0, 1);
      expect((await h.service.status({ fresh: true })).seats.used).toBe(3);
      await h.service.reserveSeat(h.db as any, {
        userId: 'u4',
        username: 'u4',
        reason: 'USER_CREATE',
      });
      // The one restored row, two markers for the two lost rows, one new seat.
      expect(h.db.seats).toHaveLength(4);
      expect(h.store.current.maxSeatsUsed).toBe(4);
      const markers = h.db.seats.filter((row) => row.reason === 'RESTORE_WATERMARK');
      expect(markers).toHaveLength(2);
    } finally {
      h.dispose();
    }
  });

  it('refuses the sixth account on a five-seat licence', async () => {
    const h = harness();
    try {
      await activation(h);
      for (let index = 1; index <= 5; index += 1) {
        await h.service.reserveSeat(h.db as any, {
          userId: `u${index}`,
          username: `u${index}`,
          reason: 'USER_CREATE',
        });
      }
      await expectCode(
        h.service.reserveSeat(h.db as any, {
          userId: 'u6',
          username: 'u6',
          reason: 'USER_CREATE',
        }),
        'LICENSE_SEATS_EXHAUSTED',
      );
    } finally {
      h.dispose();
    }
  });
});

describe('expiry', () => {
  it('blocks business use, keeps the ledger, and can be reopened by a renewal', async () => {
    const h = harness();
    try {
      await activation(h, { term: { kind: 'MONTHS', months: 1 } });
      await h.service.reserveSeat(h.db as any, {
        userId: 'u1',
        username: 'u1',
        reason: 'USER_CREATE',
      });
      h.setNow('2026-06-15T09:00:00.000Z');
      const expired = await h.service.status({ fresh: true });
      expect(expired.state).toBe('EXPIRED');
      expect(expired.blocked).toBe(true);
      expect(expired.seats.used).toBe(1);
      expect(h.db.installations).toHaveLength(1);

      const renewed = await renewal(h);
      expect(renewed.state).toBe('ACTIVE');
      expect(renewed.blocked).toBe(false);
      expect(renewed.seats.used).toBe(1);
    } finally {
      h.dispose();
    }
  });
});

describe('clock policy', () => {
  it('ignores a small difference and does not warn', async () => {
    const h = harness();
    try {
      await activation(h);
      h.setNow('2026-05-01T08:55:00.000Z'); // five minutes earlier
      const status = await h.service.status({ fresh: true });
      expect(status.clock.state).toBe('OK');
      expect(status.state).toBe('ACTIVE');
    } finally {
      h.dispose();
    }
  });

  it('warns on a large rollback and keeps the program working', async () => {
    const h = harness();
    try {
      await activation(h);
      h.setNow('2026-04-29T09:00:00.000Z'); // two days earlier
      const status = await h.service.status({ fresh: true });
      expect(status.clock.state).toBe('WARNING');
      expect(status.state).toBe('ACTIVE');
      expect(status.blocked).toBe(false);
      expect(h.db.events.some((row) => row.type === 'CLOCK_WARNING')).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it('suspends only after the rollback is confirmed, and never deletes data', async () => {
    const h = harness();
    try {
      await activation(h);
      await h.service.reserveSeat(h.db as any, {
        userId: 'u1',
        username: 'u1',
        reason: 'USER_CREATE',
      });
      // One jump of more than three days: enough on its own.
      h.setNow('2026-04-20T09:00:00.000Z');
      const status = await h.service.status({ fresh: true });
      expect(status.clock.state).toBe('TAMPERED');
      expect(status.state).toBe('SUSPENDED');
      expect(status.blocked).toBe(true);
      expect(h.db.installations[0].status).toBe('SUSPENDED');
      expect(h.db.seats).toHaveLength(1);
      expect(h.db.events.some((row) => row.type === 'CLOCK_TAMPERED')).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it('refuses to clear a suspension while the clock is still behind', async () => {
    const h = harness();
    try {
      await activation(h);
      h.setNow('2026-04-20T09:00:00.000Z');
      await h.service.status({ fresh: true });
      await expectCode(
        h.service.confirmClock({ userId: 'admin-1' }),
        'LICENSE_CLOCK_STILL_BEHIND',
      );
      h.setNow('2026-05-02T09:00:00.000Z');
      const status = await h.service.confirmClock({ userId: 'admin-1' });
      expect(status.clock.state).toBe('OK');
      expect(status.state).toBe('ACTIVE');
      expect(h.db.events.some((row) => row.type === 'CLOCK_CONFIRMED')).toBe(true);
    } finally {
      h.dispose();
    }
  });
});

describe('transfer', () => {
  it('moves the licence to the new machine with its term, limit and count', async () => {
    const h = harness();
    try {
      await activation(h, { seats: { mode: 'CAP', value: 6 } });
      for (const index of [1, 2]) {
        await h.service.reserveSeat(h.db as any, {
          userId: `u${index}`,
          username: `u${index}`,
          reason: 'USER_CREATE',
        });
      }
      // A second installation: the new machine, empty database.
      const target = harness({ machineId: OTHER_MACHINE });
      try {
        // The same key on the old machine is refused: it names the new one.
        await expectCode(
          transferKey(h, { machineId: OTHER_MACHINE, keyId: 'key_transfer-old' }),
          'LICENSE_KEY_WRONG_MACHINE',
        );
        const status = await transferKey(target, { machineId: OTHER_MACHINE });
        expect(status.state).toBe('ACTIVE');
        expect(status.expiresAt).toBe('2027-05-01T00:00:00.000Z');
        expect(status.seats).toEqual({ limit: 5, used: 3, available: 2 });
        expect(
          target.db.seats.filter((r) => r.reason === 'TRANSFER_WATERMARK'),
        ).toHaveLength(3);
        expect(target.db.installations[0].machineId).toBe(OTHER_MACHINE);
      } finally {
        target.dispose();
      }
    } finally {
      h.dispose();
    }
  });

  it('preserves seats already used on the new machine', async () => {
    const h = harness();
    try {
      h.db.seats.push(
        { licenseId: null, userId: 'n1', username: 'n1', reason: 'MIGRATION_EXISTING' },
        { licenseId: null, userId: 'n2', username: 'n2', reason: 'MIGRATION_EXISTING' },
        { licenseId: null, userId: 'n3', username: 'n3', reason: 'MIGRATION_EXISTING' },
        { licenseId: null, userId: 'n4', username: 'n4', reason: 'MIGRATION_EXISTING' },
      );
      const status = await transferKey(h, { keyId: 'key_transfer-2' });
      // The generator says three were used; the machine already had four, so
      // four must stay counted - a transfer never hands a seat back.
      expect(status.seats.used).toBe(4);
      expect(h.db.seats).toHaveLength(4);
      expect(h.db.seats.every((row) => row.licenseId === LICENSE)).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it('refuses a transfer to a machine with more accounts than the licence allows', async () => {
    const h = harness();
    try {
      for (let index = 1; index <= 6; index += 1) {
        h.db.seats.push({
          licenseId: null,
          userId: `n${index}`,
          username: `n${index}`,
          reason: 'MIGRATION_EXISTING',
        });
      }
      await expectCode(
        transferKey(h, { keyId: 'key_transfer-3' }),
        'LICENSE_SEATS_BELOW_USED',
      );
      expect(h.db.installations).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it('cannot be used to extend the term or raise the limit on a licensed machine', async () => {
    const h = harness();
    try {
      await activation(h);
      await expectCode(
        h.service.renew(
          h.key({
            type: 'TRANSFER',
            keyId: 'key_transfer-as-renewal',
            term: null,
            seats: null,
            state: {
              expiresAt: '2030-01-01T00:00:00.000Z',
              seatLimit: 50,
              seatsUsed: 0,
              startsAt: '2026-05-01T00:00:00.000Z',
              issuedAt: '2026-05-01T00:00:00.000Z',
            },
          }),
        ),
        'LICENSE_KEY_WRONG_TYPE',
      );
      expect((await h.service.status({ fresh: true })).seats.limit).toBe(5);
    } finally {
      h.dispose();
    }
  });
});
