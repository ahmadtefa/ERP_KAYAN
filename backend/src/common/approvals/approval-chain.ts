/// The approval chain resolver.
///
/// This file is deliberately free of database and Nest imports: the decision
/// "which levels does this document need, and has each been satisfied?" is the
/// part most likely to be got wrong, so it is written as a pure function that
/// a test can drive with plain objects.
///
/// ## The one rule that makes this safe to introduce
///
/// A company that has written no policy keeps the historical behaviour. That
/// is represented explicitly, by `source: 'LEGACY'`, rather than by "an empty
/// chain happens to pass" — because an empty chain that passes is also what a
/// half-configured policy would look like, and those two must not be confused.

export type ApprovalDecisionKind = 'APPROVE' | 'REJECT' | 'RETURN';

export interface ApprovalLevelRule {
  level: number;
  nameEn: string;
  nameAr: string;
  permission: string;
  roleCode: string | null;
  optional: boolean;
}

export interface ApprovalPolicyRule {
  id: string;
  nameEn: string;
  nameAr: string;
  priority: number;
  branchId: string | null;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  minimumAmount: string | null;
  minimumQuantity: string | null;
  alwaysRequire: boolean;
  levels: ApprovalLevelRule[];
}

/// What the document is, reduced to the facts a policy can match on.
export interface ApprovalSubject {
  branchIds: string[];
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  amount: string | null;
  quantity: string | null;
  /// True when at least one line had no cost we could trust, so `amount`
  /// understates the move. A policy written against a money threshold cannot
  /// be allowed to decide whether its own guard applies, so the document is
  /// treated as *at or above every* amount threshold. The real cost still has
  /// to be filled in before the goods leave; see `stock-transfers.service.ts`.
  amountUnderstated?: boolean;
}

export interface RecordedDecision {
  level: number;
  decision: ApprovalDecisionKind;
  actorId: string;
  actorRoleCode: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface ApprovalChain {
  /// `LEGACY` — no policy matched, the historical review/approve doors apply.
  /// `POLICY` — a configured chain governs this document.
  source: 'LEGACY' | 'POLICY';
  policyId: string | null;
  policyNameEn: string | null;
  policyNameAr: string | null;
  levels: ApprovalLevelRule[];
}

export const LEGACY_CHAIN: ApprovalChain = {
  source: 'LEGACY',
  policyId: null,
  policyNameEn: null,
  policyNameAr: null,
  levels: [],
};

/// Decimal-free comparison so this module stays a pure function.
///
/// Amounts and quantities arrive from Prisma as strings with up to four
/// decimals. Scaling to integers avoids the rounding that `Number` would
/// introduce, and is more than enough for a comparison against a threshold.
function scaled(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const padded = (fraction + '0000').slice(0, 4);
  const magnitude = BigInt(whole + padded);
  return negative ? -magnitude : magnitude;
}

function atLeast(actual: string | null, threshold: string | null): boolean {
  const floor = scaled(threshold);
  if (floor === null) return true;
  const value = scaled(actual);
  if (value === null) return false;
  return value >= floor;
}

/// Does this policy's conditions hold for this document?
///
/// Every unset condition is a wildcard. That is the whole point of the
/// feature: a company writes a narrow rule for the big cross-branch moves and
/// leaves everything else on the default path.
export function policyMatches(policy: ApprovalPolicyRule, subject: ApprovalSubject): boolean {
  if (policy.branchId && !subject.branchIds.includes(policy.branchId)) return false;
  if (policy.sourceWarehouseId && policy.sourceWarehouseId !== subject.sourceWarehouseId) return false;
  if (policy.destinationWarehouseId && policy.destinationWarehouseId !== subject.destinationWarehouseId) return false;
  // An understated amount never disqualifies a money rule: the guard's whole
  // job is to catch the expensive move, and "we could not price it" is not
  // evidence that it was cheap.
  if (!subject.amountUnderstated && !atLeast(subject.amount, policy.minimumAmount)) return false;
  if (!atLeast(subject.quantity, policy.minimumQuantity)) return false;
  return true;
}

/// Choose the chain that governs this document.
///
/// The lowest `priority` wins; a tie is broken by the policy id so the answer
/// is stable rather than dependent on the database's row order. A policy that
/// matched but has no levels cannot approve anything, so it is treated as
/// absent unless it explicitly says `alwaysRequire`, in which case it is a
/// configuration error the caller must report rather than silently skip.
export function resolveChain(policies: ApprovalPolicyRule[], subject: ApprovalSubject): ApprovalChain {
  const candidates = policies
    .filter((policy) => policyMatches(policy, subject))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const policy of candidates) {
    const levels = [...policy.levels].sort((a, b) => a.level - b.level);
    if (levels.length === 0) {
      if (policy.alwaysRequire) {
        throw new Error(
          `Approval policy "${policy.nameEn}" matches this document but has no levels configured`,
        );
      }
      continue;
    }
    return {
      source: 'POLICY',
      policyId: policy.id,
      policyNameEn: policy.nameEn,
      policyNameAr: policy.nameAr,
      levels,
    };
  }
  return LEGACY_CHAIN;
}

export interface ChainState {
  /// The lowest level that still needs a decision, or null when complete.
  pendingLevel: number | null;
  /// The highest level satisfied in order, ignoring any decision that arrived
  /// out of sequence.
  satisfiedThrough: number;
  isComplete: boolean;
  /// The decision that stopped the chain, when there is one.
  stopped: RecordedDecision | null;
}

/// Fold recorded decisions into the state of the chain.
///
/// Decisions are applied in level order and each level is satisfied by its
/// earliest APPROVE. Two consequences matter:
///
/// * **Out-of-order approvals do not skip ahead.** A level-2 approval recorded
///   before level 1 is satisfied does not close level 1; the chain waits. This
///   is what stops a junior approver from completing a chain a senior one was
///   supposed to open.
/// * **The first REJECT or RETURN ends the chain**, and the document must go
///   back to the requester rather than forward. Returning for amendment is
///   *not* a rejection: the requester can edit and resubmit, and the recorded
///   history keeps the reason either way.
export function foldDecisions(
  chain: ApprovalChain,
  decisions: RecordedDecision[],
): ChainState {
  const ordered = [...decisions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const stop = ordered.find(
    (decision) => decision.decision === 'REJECT' || decision.decision === 'RETURN',
  );
  if (stop) {
    return {
      pendingLevel: null,
      satisfiedThrough: Math.max(0, stop.level - 1),
      isComplete: false,
      stopped: stop,
    };
  }
  let satisfiedThrough = 0;
  for (const rule of chain.levels) {
    const approval = ordered.find(
      (decision) => decision.decision === 'APPROVE' && decision.level === rule.level,
    );
    if (!approval) break;
    satisfiedThrough = rule.level;
  }
  const lastLevel = chain.levels.length ? chain.levels[chain.levels.length - 1].level : 0;
  const isComplete = chain.levels.length > 0 && satisfiedThrough === lastLevel;
  return {
    pendingLevel: isComplete ? null : satisfiedThrough + 1,
    satisfiedThrough,
    isComplete,
    stopped: null,
  };
}

/// May this actor close this level?
///
/// Three separate things must all be true, and keeping them separate is the
/// point:
///
/// 1. the actor holds the level's permission;
/// 2. the actor holds the level's role, when the level names one;
/// 3. the actor did not write the document, and has not already decided this
///    same level — separation of duties.
///
/// The requester check is unconditional under a configured policy. Under the
/// historical flow the same rule is enforced by the service, so the two
/// behaviours agree.
export function mayDecide(
  chain: ApprovalChain,
  level: ApprovalLevelRule,
  actor: { userId: string; permissions: string[]; roles: string[] },
  context: { requesterId: string; decisions: RecordedDecision[] },
): { allowed: true } | { allowed: false; reason: string; code: string; params?: Record<string, string> } {
  if (!actor.permissions.includes(level.permission) && !actor.permissions.includes('*')) {
    return { allowed: false, reason: `This level requires ${level.permission}`, code: 'APPROVAL_LEVEL_PERMISSION', params: { permission: level.permission } };
  }
  if (level.roleCode && !actor.roles.includes(level.roleCode)) {
    return { allowed: false, reason: `This level is restricted to the ${level.roleCode} role`, code: 'APPROVAL_LEVEL_ROLE', params: { role: level.roleCode } };
  }
  if (actor.userId === context.requesterId) {
    return { allowed: false, reason: 'The requester cannot decide their own approval', code: 'APPROVAL_SELF_DECISION' };
  }
  const already = context.decisions.some(
    (decision) => decision.level === level.level && decision.actorId === actor.userId,
  );
  if (already) {
    return { allowed: false, reason: 'You have already decided this level', code: 'APPROVAL_ALREADY_DECIDED' };
  }
  void chain;
  return { allowed: true };
}
