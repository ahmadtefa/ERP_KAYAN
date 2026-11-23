import {
  LEGACY_CHAIN,
  RecordedDecision,
  foldDecisions,
  mayDecide,
  policyMatches,
  resolveChain,
} from './approval-chain';

const policy = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  nameEn: 'Cross-branch moves',
  nameAr: 'التحويلات بين الفروع',
  priority: 100,
  branchId: null,
  sourceWarehouseId: null,
  destinationWarehouseId: null,
  minimumAmount: null,
  minimumQuantity: null,
  alwaysRequire: false,
  levels: [
    { level: 1, nameEn: 'Warehouse manager', nameAr: 'مدير المخزن', permission: 'inventory.transfer.approve', roleCode: 'WAREHOUSE_MANAGER', optional: false },
    { level: 2, nameEn: 'Branch manager', nameAr: 'مدير الفرع', permission: 'inventory.transfer.approve', roleCode: 'GENERAL_MANAGER', optional: false },
  ],
  ...over,
});

const subject = (over: Record<string, unknown> = {}) => ({
  branchIds: ['b1', 'b2'],
  sourceWarehouseId: 'w1',
  destinationWarehouseId: 'w2',
  amount: '1200.0000',
  quantity: '40.0000',
  ...over,
});

const decision = (
  level: number,
  kind: 'APPROVE' | 'REJECT' | 'RETURN',
  at: string,
  actorId = `user-${level}`,
): RecordedDecision => ({
  level,
  decision: kind,
  actorId,
  actorRoleCode: null,
  reason: kind === 'APPROVE' ? null : 'because',
  createdAt: new Date(at),
});

describe('approval chain resolution', () => {
  it('keeps the historical flow when the company has written no policy', () => {
    expect(resolveChain([], subject())).toEqual(LEGACY_CHAIN);
    expect(resolveChain([], subject()).source).toBe('LEGACY');
  });

  it('treats every unset condition as a wildcard', () => {
    expect(policyMatches(policy(), subject())).toBe(true);
    expect(policyMatches(policy(), subject({ amount: '0.0000', quantity: '0' }))).toBe(true);
  });

  it('matches on the source shelf, the destination shelf and the branch', () => {
    expect(policyMatches(policy({ sourceWarehouseId: 'w1' }), subject())).toBe(true);
    expect(policyMatches(policy({ sourceWarehouseId: 'w9' }), subject())).toBe(false);
    expect(policyMatches(policy({ destinationWarehouseId: 'w2' }), subject())).toBe(true);
    expect(policyMatches(policy({ destinationWarehouseId: 'w9' }), subject())).toBe(false);
    expect(policyMatches(policy({ branchId: 'b2' }), subject())).toBe(true);
    expect(policyMatches(policy({ branchId: 'b9' }), subject())).toBe(false);
  });

  it('applies an amount threshold inclusively, without floating-point drift', () => {
    expect(policyMatches(policy({ minimumAmount: '1200' }), subject({ amount: '1200.0000' }))).toBe(true);
    expect(policyMatches(policy({ minimumAmount: '1200.0001' }), subject({ amount: '1200.0000' }))).toBe(false);
    // 0.1 + 0.2 style drift must not decide an approval.
    expect(policyMatches(policy({ minimumAmount: '0.3' }), subject({ amount: '0.3000' }))).toBe(true);
    expect(policyMatches(policy({ minimumQuantity: '40' }), subject({ quantity: '40' }))).toBe(true);
    expect(policyMatches(policy({ minimumQuantity: '41' }), subject({ quantity: '40' }))).toBe(false);
  });

  it('lets nothing below an amount threshold match when the amount is unknown', () => {
    expect(policyMatches(policy({ minimumAmount: '1' }), subject({ amount: null }))).toBe(false);
  });

  it('picks the lowest priority and breaks a tie stably', () => {
    const low = policy({ id: 'b', priority: 10 });
    const high = policy({ id: 'a', priority: 20 });
    expect(resolveChain([high, low], subject()).policyId).toBe('b');
    const tieA = policy({ id: 'aaa', priority: 50 });
    const tieB = policy({ id: 'bbb', priority: 50 });
    expect(resolveChain([tieB, tieA], subject()).policyId).toBe('aaa');
    expect(resolveChain([tieA, tieB], subject()).policyId).toBe('aaa');
  });

  it('skips a narrower rule that does not match and falls through to a broader one', () => {
    const narrow = policy({ id: 'narrow', priority: 1, sourceWarehouseId: 'elsewhere' });
    const broad = policy({ id: 'broad', priority: 2 });
    expect(resolveChain([narrow, broad], subject()).policyId).toBe('broad');
  });

  it('ignores an empty policy rather than letting it approve everything', () => {
    const empty = policy({ id: 'empty', priority: 1, levels: [] });
    const real = policy({ id: 'real', priority: 2 });
    expect(resolveChain([empty, real], subject()).policyId).toBe('real');
  });

  it('refuses to fall through when a matched policy demands approval but has no levels', () => {
    const broken = policy({ id: 'broken', priority: 1, levels: [], alwaysRequire: true });
    expect(() => resolveChain([broken], subject())).toThrow(/no levels configured/);
  });

  it('orders levels regardless of the order they were stored in', () => {
    const shuffled = policy({
      levels: [
        { level: 2, nameEn: 'b', nameAr: 'ب', permission: 'x', roleCode: null, optional: false },
        { level: 1, nameEn: 'a', nameAr: 'أ', permission: 'x', roleCode: null, optional: false },
      ],
    });
    expect(resolveChain([shuffled], subject()).levels.map((l) => l.level)).toEqual([1, 2]);
  });
});

describe('approval chain state', () => {
  const chain = resolveChain([policy()], subject());

  it('is pending at level 1 with no decisions', () => {
    const state = foldDecisions(chain, []);
    expect(state).toMatchObject({ pendingLevel: 1, satisfiedThrough: 0, isComplete: false, stopped: null });
  });

  it('is complete only after the last level is approved', () => {
    const afterOne = foldDecisions(chain, [decision(1, 'APPROVE', '2026-01-01T00:00:00Z')]);
    expect(afterOne).toMatchObject({ pendingLevel: 2, satisfiedThrough: 1, isComplete: false });
    const afterBoth = foldDecisions(chain, [
      decision(1, 'APPROVE', '2026-01-01T00:00:00Z'),
      decision(2, 'APPROVE', '2026-01-02T00:00:00Z'),
    ]);
    expect(afterBoth).toMatchObject({ pendingLevel: null, satisfiedThrough: 2, isComplete: true });
  });

  it('does not let an out-of-order approval skip the level before it', () => {
    const state = foldDecisions(chain, [decision(2, 'APPROVE', '2026-01-01T00:00:00Z')]);
    expect(state).toMatchObject({ pendingLevel: 1, satisfiedThrough: 0, isComplete: false });
  });

  it('stops at the first rejection and never completes', () => {
    const state = foldDecisions(chain, [
      decision(1, 'APPROVE', '2026-01-01T00:00:00Z'),
      decision(2, 'REJECT', '2026-01-02T00:00:00Z'),
    ]);
    expect(state.isComplete).toBe(false);
    expect(state.stopped).toMatchObject({ level: 2, decision: 'REJECT' });
  });

  it('treats a return for amendment as a stop, not an approval', () => {
    const state = foldDecisions(chain, [decision(1, 'RETURN', '2026-01-01T00:00:00Z')]);
    expect(state.isComplete).toBe(false);
    expect(state.stopped).toMatchObject({ level: 1, decision: 'RETURN' });
    expect(state.pendingLevel).toBeNull();
  });

  it('records the earliest rejection when several arrive', () => {
    const state = foldDecisions(chain, [
      decision(1, 'REJECT', '2026-01-02T00:00:00Z'),
      decision(1, 'REJECT', '2026-01-01T00:00:00Z'),
    ]);
    expect(state.stopped?.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('who may decide a level', () => {
  const chain = resolveChain([policy()], subject());
  const level1 = chain.levels[0];
  const actor = (over: Record<string, unknown> = {}) => ({
    userId: 'u-manager',
    permissions: ['inventory.transfer.approve'],
    roles: ['WAREHOUSE_MANAGER'],
    ...over,
  });

  it('allows somebody holding the level permission and role', () => {
    expect(mayDecide(chain, level1, actor(), { requesterId: 'u-requester', decisions: [] }))
      .toEqual({ allowed: true });
  });

  it('refuses a person without the level permission', () => {
    const verdict = mayDecide(chain, level1, actor({ permissions: ['inventory.transfer.read'] }), {
      requesterId: 'u-requester', decisions: [],
    });
    expect(verdict.allowed).toBe(false);
  });

  it('refuses a person without the level role even when they hold the permission', () => {
    const verdict = mayDecide(chain, level1, actor({ roles: ['STOREKEEPER'] }), {
      requesterId: 'u-requester', decisions: [],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toMatch(/WAREHOUSE_MANAGER/);
  });

  it('refuses the requester even when they hold every permission', () => {
    const verdict = mayDecide(chain, level1, actor({ roles: ['WAREHOUSE_MANAGER', 'ADMIN'] }), {
      requesterId: 'u-manager', decisions: [],
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed === false && verdict.reason).toMatch(/requester/);
  });

  it('refuses a second decision from the same person at the same level', () => {
    const verdict = mayDecide(chain, level1, actor(), {
      requesterId: 'u-requester',
      decisions: [decision(1, 'APPROVE', '2026-01-01T00:00:00Z', 'u-manager')],
    });
    expect(verdict.allowed).toBe(false);
  });

  it('allows the same person a different level, when they hold both roles', () => {
    const level2 = chain.levels[1];
    const boss = actor({ roles: ['WAREHOUSE_MANAGER', 'GENERAL_MANAGER'] });
    expect(mayDecide(chain, level2, boss, {
      requesterId: 'u-requester',
      decisions: [decision(1, 'APPROVE', '2026-01-01T00:00:00Z', 'u-manager')],
    })).toEqual({ allowed: true });
  });

  it('treats the wildcard grant as holding the permission', () => {
    expect(mayDecide(chain, level1, actor({ permissions: ['*'] }), {
      requesterId: 'u-requester', decisions: [],
    })).toEqual({ allowed: true });
  });
});
