import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApprovalChain,
  ApprovalDecisionKind,
  ApprovalPolicyRule,
  ApprovalSubject,
  LEGACY_CHAIN,
  RecordedDecision,
  foldDecisions,
  mayDecide,
  resolveChain,
} from './approval-chain';

/// Operations the engine can govern. Kept as a narrow union on purpose: a
/// policy naming an operation nothing enforces would be a setting that lies.
export const APPROVAL_OPERATIONS = ['STOCK_TRANSFER'] as const;
export type ApprovalOperation = (typeof APPROVAL_OPERATIONS)[number];

export interface ApprovalActor {
  userId: string;
  companyId: string;
  permissions: string[];
  roles: string[];
}

export interface LevelInput {
  level?: number;
  nameEn: string;
  nameAr: string;
  permission: string;
  roleCode?: string | null;
  optional?: boolean;
}

export interface PolicyInput {
  operation: string;
  nameEn: string;
  nameAr: string;
  priority?: number;
  isActive?: boolean;
  branchId?: string | null;
  sourceWarehouseId?: string | null;
  destinationWarehouseId?: string | null;
  minimumAmount?: string | number | null;
  minimumQuantity?: string | number | null;
  alwaysRequire?: boolean;
  levels: LevelInput[];
}

const POLICIES = 'approval_policies';
const DECISIONS = 'approval_decisions';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────────────────────────────────────── configuration

  async listPolicies(companyId: string) {
    const rows = await this.prisma.approvalPolicy.findMany({
      where: { companyId },
      orderBy: [{ operation: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      include: { levels: { orderBy: { level: 'asc' } } },
    });
    return { items: rows.map((row) => this.presentPolicy(row)) };
  }

  async createPolicy(actor: ApprovalActor, input: PolicyInput) {
    const clean = this.validatePolicy(input);
    const created = await this.prisma.approvalPolicy.create({
      data: {
        companyId: actor.companyId,
        operation: clean.operation,
        nameEn: clean.nameEn,
        nameAr: clean.nameAr,
        priority: clean.priority,
        isActive: clean.isActive,
        branchId: clean.branchId,
        sourceWarehouseId: clean.sourceWarehouseId,
        destinationWarehouseId: clean.destinationWarehouseId,
        minimumAmount: clean.minimumAmount,
        minimumQuantity: clean.minimumQuantity,
        alwaysRequire: clean.alwaysRequire,
        createdBy: actor.userId,
        levels: { create: clean.levels },
      },
    });
    // Re-read rather than trust the create's return shape: the levels were
    // written by a nested insert, and the caller wants the stored truth.
    const stored = await this.prisma.approvalPolicy.findUniqueOrThrow({
      where: { id: created.id },
      include: { levels: { orderBy: { level: 'asc' } } },
    });
    await this.audit.record({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'CREATE',
      entity: POLICIES,
      entityId: created.id,
      after: { operation: stored.operation, levels: stored.levels.length },
    });
    return this.presentPolicy(stored);
  }

  async updatePolicy(actor: ApprovalActor, id: string, input: PolicyInput) {
    const existing = await this.prisma.approvalPolicy.findFirst({
      where: { id, companyId: actor.companyId },
      include: { levels: true },
    });
    if (!existing) throw new NotFoundException({ code: 'APPROVAL_POLICY_NOT_FOUND', message: 'Approval policy not found' });
    const clean = this.validatePolicy({ ...input, operation: existing.operation });
    // Levels are replaced wholesale inside one transaction: a chain with a
    // half-updated sequence would be a rule nobody wrote.
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.approvalPolicy.update({
        where: { id },
        data: {
          nameEn: clean.nameEn,
          nameAr: clean.nameAr,
          priority: clean.priority,
          isActive: clean.isActive,
          branchId: clean.branchId,
          sourceWarehouseId: clean.sourceWarehouseId,
          destinationWarehouseId: clean.destinationWarehouseId,
          minimumAmount: clean.minimumAmount,
          minimumQuantity: clean.minimumQuantity,
          alwaysRequire: clean.alwaysRequire,
        },
      });
      await tx.approvalLevel.deleteMany({ where: { policyId: id } });
      await tx.approvalLevel.createMany({
        data: clean.levels.map((level) => ({ ...level, policyId: id })),
      });
      return tx.approvalPolicy.findUniqueOrThrow({
        where: { id },
        include: { levels: { orderBy: { level: 'asc' } } },
      });
    });
    await this.audit.record({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'UPDATE',
      entity: POLICIES,
      entityId: id,
      before: { operation: existing.operation, levels: existing.levels.length },
      after: { operation: updated.operation, levels: updated.levels.length },
    });
    return this.presentPolicy(updated);
  }

  async deletePolicy(actor: ApprovalActor, id: string) {
    const existing = await this.prisma.approvalPolicy.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!existing) throw new NotFoundException({ code: 'APPROVAL_POLICY_NOT_FOUND', message: 'Approval policy not found' });
    // Decisions keep their recorded history; the policy link is nulled by the
    // foreign key rather than taking the history with it.
    await this.prisma.approvalPolicy.delete({ where: { id } });
    await this.audit.record({
      companyId: actor.companyId,
      userId: actor.userId,
      action: 'DELETE',
      entity: POLICIES,
      entityId: id,
      before: { operation: existing.operation },
    });
    return { deleted: true };
  }

  private validatePolicy(input: PolicyInput) {
    const operation = String(input.operation ?? '').trim().toUpperCase();
    if (!APPROVAL_OPERATIONS.includes(operation as ApprovalOperation)) {
      throw new BadRequestException({ code: 'APPROVAL_OPERATION_UNKNOWN', message: `Operation must be one of ${APPROVAL_OPERATIONS.join(', ')}` });
    }
    const nameEn = String(input.nameEn ?? '').trim();
    const nameAr = String(input.nameAr ?? '').trim();
    if (!nameEn || !nameAr) throw new BadRequestException({ code: 'APPROVAL_POLICY_NAME', message: 'A policy name is required in both languages' });
    if (nameEn.length > 120 || nameAr.length > 120) throw new BadRequestException({ code: 'APPROVAL_POLICY_NAME', message: 'A policy name may be at most 120 characters' });
    const priority = input.priority === undefined ? 100 : Number(input.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100000) {
      throw new BadRequestException({ code: 'APPROVAL_PRIORITY_RANGE', message: 'Priority must be a whole number between 0 and 100000' });
    }
    const levelsInput = Array.isArray(input.levels) ? input.levels : [];
    if (levelsInput.length > 10) throw new BadRequestException({ code: 'APPROVAL_TOO_MANY_LEVELS', message: 'A policy may have at most 10 levels' });
    const seen = new Set<number>();
    const levels = levelsInput.map((level, index) => {
      const number = level.level === undefined ? index + 1 : Number(level.level);
      if (!Number.isInteger(number) || number < 1 || number > 10) {
        throw new BadRequestException({ code: 'APPROVAL_LEVELS_NUMBERING', message: 'Levels must be numbered 1 to 10' });
      }
      if (seen.has(number)) throw new BadRequestException({ code: 'APPROVAL_LEVEL_REPEATED', message: `Level ${number} is repeated` });
      seen.add(number);
      const permission = String(level.permission ?? '').trim();
      if (!permission) throw new BadRequestException({ code: 'APPROVAL_LEVEL_PERMISSION', message: `Level ${number} needs a permission` });
      if (permission.length > 120) throw new BadRequestException({ code: 'APPROVAL_LEVEL_PERMISSION', message: `Level ${number}: permission code is too long` });
      const levelNameEn = String(level.nameEn ?? '').trim() || `Level ${number}`;
      const levelNameAr = String(level.nameAr ?? '').trim() || `المستوى ${number}`;
      return {
        level: number,
        nameEn: levelNameEn.slice(0, 120),
        nameAr: levelNameAr.slice(0, 120),
        permission,
        roleCode: level.roleCode?.trim() || null,
        optional: Boolean(level.optional),
      };
    });
    levels.sort((a, b) => a.level - b.level);
    // Renumber 1..n so a chain can never have a gap. A gap would make
    // `satisfiedThrough + 1` point at a level that does not exist.
    levels.forEach((level, index) => {
      level.level = index + 1;
    });
    const decimal = (value: string | number | null | undefined, label: string) => {
      if (value === null || value === undefined || String(value).trim() === '') return null;
      let parsed: Prisma.Decimal;
      try {
        parsed = new Prisma.Decimal(String(value));
      } catch {
        throw new BadRequestException({ code: 'APPROVAL_NUMBER_INVALID', message: `${label} must be numeric` });
      }
      if (!parsed.isFinite() || parsed.lessThan(0)) throw new BadRequestException({ code: 'APPROVAL_NUMBER_INVALID', message: `${label} must not be negative` });
      return parsed;
    };
    return {
      operation,
      nameEn,
      nameAr,
      priority,
      isActive: input.isActive === undefined ? true : Boolean(input.isActive),
      branchId: input.branchId || null,
      sourceWarehouseId: input.sourceWarehouseId || null,
      destinationWarehouseId: input.destinationWarehouseId || null,
      minimumAmount: decimal(input.minimumAmount, 'Minimum amount'),
      minimumQuantity: decimal(input.minimumQuantity, 'Minimum quantity'),
      alwaysRequire: Boolean(input.alwaysRequire),
      levels,
    };
  }

  private presentPolicy(row: {
    id: string;
    operation: string;
    nameEn: string;
    nameAr: string;
    priority: number;
    isActive: boolean;
    branchId: string | null;
    sourceWarehouseId: string | null;
    destinationWarehouseId: string | null;
    minimumAmount: Prisma.Decimal | null;
    minimumQuantity: Prisma.Decimal | null;
    alwaysRequire: boolean;
    levels: Array<{ level: number; nameEn: string; nameAr: string; permission: string; roleCode: string | null; optional: boolean }>;
  }) {
    return {
      id: row.id,
      operation: row.operation,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      priority: row.priority,
      isActive: row.isActive,
      branchId: row.branchId,
      sourceWarehouseId: row.sourceWarehouseId,
      destinationWarehouseId: row.destinationWarehouseId,
      minimumAmount: row.minimumAmount ? row.minimumAmount.toString() : null,
      minimumQuantity: row.minimumQuantity ? row.minimumQuantity.toString() : null,
      alwaysRequire: row.alwaysRequire,
      levels: row.levels.map((level) => ({
        level: level.level,
        nameEn: level.nameEn,
        nameAr: level.nameAr,
        permission: level.permission,
        roleCode: level.roleCode,
        optional: level.optional,
      })),
    };
  }

  // ───────────────────────────────────────────────────────────── enforcement

  /// The chain that governs one document, given the facts about it.
  async chainFor(companyId: string, operation: ApprovalOperation, subject: ApprovalSubject): Promise<ApprovalChain> {
    const rows = await this.prisma.approvalPolicy.findMany({
      where: { companyId, operation, isActive: true },
      include: { levels: { orderBy: { level: 'asc' } } },
    });
    if (rows.length === 0) return LEGACY_CHAIN;
    const rules: ApprovalPolicyRule[] = rows.map((row) => ({
      id: row.id,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      priority: row.priority,
      branchId: row.branchId,
      sourceWarehouseId: row.sourceWarehouseId,
      destinationWarehouseId: row.destinationWarehouseId,
      minimumAmount: row.minimumAmount ? row.minimumAmount.toString() : null,
      minimumQuantity: row.minimumQuantity ? row.minimumQuantity.toString() : null,
      alwaysRequire: row.alwaysRequire,
      levels: row.levels.map((level) => ({
        level: level.level,
        nameEn: level.nameEn,
        nameAr: level.nameAr,
        permission: level.permission,
        roleCode: level.roleCode,
        optional: level.optional,
      })),
    }));
    try {
      return resolveChain(rules, subject);
    } catch (error) {
      // A matched policy with no levels is a configuration mistake, and the
      // right answer is to stop the document rather than let it through a
      // chain nobody can satisfy.
      throw new ConflictException({ code: 'APPROVALS_CHAIN_FOR_E001', message: error instanceof Error ? error.message : 'Approval chain is misconfigured' });
    }
  }

  async decisions(companyId: string, entityType: string, entityId: string): Promise<RecordedDecision[]> {
    const rows = await this.prisma.approvalDecision.findMany({
      where: { companyId, entityType, entityId },
      orderBy: [{ createdAt: 'asc' }, { level: 'asc' }],
      select: { level: true, decision: true, actorId: true, actorRoleCode: true, reason: true, createdAt: true },
    });
    return rows.map((row) => ({
      level: row.level,
      decision: row.decision as ApprovalDecisionKind,
      actorId: row.actorId,
      actorRoleCode: row.actorRoleCode,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  /// `since` is when the document was last (re)submitted. A request that was
  /// returned and sent in again starts a fresh round at level 1: the earlier
  /// round stays in the history but no longer decides who is pending.
  async stateFor(
    companyId: string,
    chain: ApprovalChain,
    entityType: string,
    entityId: string,
    since?: Date | null,
  ) {
    const decisions = (await this.decisions(companyId, entityType, entityId)).filter(
      (decision) => !since || decision.createdAt.getTime() >= since.getTime(),
    );
    return { chain, decisions, state: foldDecisions(chain, decisions) };
  }

  /// The decision that completed (or would complete) the chain: the highest
  /// approved level of the current round. A replayed earlier level is not it.
  async finalApprovalId(companyId: string, entityType: string, entityId: string, since?: Date | null): Promise<string | null> {
    const row = await this.prisma.approvalDecision.findFirst({
      where: { companyId, entityType, entityId, decision: 'APPROVE', ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /// The decision recorded under one client key, if any.
  async keyedDecision(companyId: string, entityType: string, entityId: string, requestKey: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; level: number; decision: string; actorId: string; createdAt: Date; requestHash: string | null; policyId: string | null; completesChain: boolean | null }>>`
      SELECT id, level, decision, "actorId", "createdAt", "requestHash", "policyId", "completesChain" FROM approval_decisions
      WHERE "companyId"=${companyId}::uuid AND "entityType"=${entityType} AND "entityId"=${entityId}::uuid AND "requestKey"=${requestKey} LIMIT 1`;
    return rows[0] ?? null;
  }

  /// Record one decision, enforcing both the chain and separation of duties.
  ///
  /// `expectedLevel` is what the caller believes it is deciding. Passing it
  /// means two people who both looked at "level 2" cannot both record a
  /// level-2 approval when only one of them was current.
  async decide(
    actor: ApprovalActor,
    params: {
      entityType: string;
      entityId: string;
      chain: ApprovalChain;
      requesterId: string;
      decision: ApprovalDecisionKind;
      reason?: string | null;
      expectedLevel?: number | null;
      /// When the document was last submitted; earlier rounds are history only.
      since?: Date | null;
      /// Client key. A repeat with the same actor and decision returns the
      /// recorded decision; any other use of the key is a conflict.
      requestKey?: string | null;
    },
  ) {
    const { decision, entityType, entityId, chain } = params;
    if (!['APPROVE', 'REJECT', 'RETURN'].includes(decision)) {
      throw new BadRequestException({ code: 'APPROVAL_DECISION_UNKNOWN', message: 'Decision must be APPROVE, REJECT or RETURN' });
    }
    const reason = params.reason?.trim() || null;
    if ((decision === 'REJECT' || decision === 'RETURN') && !reason) {
      throw new BadRequestException({ code: 'APPROVAL_REASON_REQUIRED', message: 'A rejection or return needs a reason' });
    }
    if (reason && reason.length > 2000) throw new BadRequestException({ code: 'APPROVAL_REASON_LONG', message: 'A reason may be at most 2000 characters' });
    if (chain.source === 'LEGACY') {
      throw new ConflictException({ code: 'APPROVAL_NO_CHAIN', message: 'This document does not use a configured approval chain' });
    }
    const requestKey = params.requestKey ? String(params.requestKey).slice(0, 160) : null;
    // Everything the caller chose is part of the key's fingerprint: a retry with
    // an altered reason, expected level, policy or round is a different request.
    const fingerprint = createHash('sha256').update(JSON.stringify({
      entityType, entityId, actor: actor.userId, decision, reason: reason ?? null,
      expectedLevel: params.expectedLevel ?? null, policyId: chain.policyId ?? null,
      since: params.since ? params.since.toISOString() : null,
    })).digest('hex');
    // Checked before any chain-state refusal, so a replay after the chain moved
    // on still reports the decision it recorded.
    if (requestKey) {
      const prior = await this.keyedDecision(actor.companyId, entityType, entityId, requestKey);
      if (prior) {
        if (prior.actorId !== actor.userId || prior.decision !== decision || prior.requestHash !== fingerprint) {
          throw new ConflictException({ code: 'APPROVAL_KEY_REUSED', message: 'Idempotency key was reused for a different approval decision' });
        }
        const replayState = await this.stateFor(actor.companyId, chain, entityType, entityId, params.since ?? null);
        return { decision: prior, ...replayState, replayed: true };
      }
    }
    const everything = await this.decisions(actor.companyId, entityType, entityId);
    const since = params.since ?? null;
    const existing = everything.filter(
      (item) => !since || item.createdAt.getTime() >= since.getTime(),
    );
    const cycle = everything.filter((item) => item.decision === 'RETURN').length + 1;
    const state = foldDecisions(chain, existing);
    if (state.stopped) throw new ConflictException({ code: 'APPROVAL_ALREADY_DECIDED', message: 'This approval chain has already been decided' });
    if (state.isComplete) throw new ConflictException({ code: 'APPROVAL_ALREADY_DECIDED', message: 'This approval chain is already complete' });
    const levelNumber = state.pendingLevel;
    if (!levelNumber) throw new ConflictException({ code: 'APPROVAL_NO_PENDING_LEVEL', message: 'There is no level awaiting a decision' });
    if (params.expectedLevel !== undefined && params.expectedLevel !== null && params.expectedLevel !== levelNumber) {
      throw new ConflictException({ code: 'APPROVAL_LEVEL_MOVED', message: `Level ${params.expectedLevel} is no longer the pending level; level ${levelNumber} is` });
    }
    const level = chain.levels.find((candidate) => candidate.level === levelNumber);
    if (!level) throw new ConflictException({ code: 'APPROVAL_NO_PENDING_LEVEL', message: 'The pending level is missing from the policy' });
    const verdict = mayDecide(
      chain,
      level,
      { userId: actor.userId, permissions: actor.permissions, roles: actor.roles },
      { requesterId: params.requesterId, decisions: existing },
    );
    if (!verdict.allowed) throw new ForbiddenException({ code: verdict.code, message: verdict.reason, ...(verdict.params ? { params: verdict.params } : {}) });
    const roleCode = actor.roles.find((role) => !level.roleCode || role === level.roleCode) ?? null;
    // Frozen with the decision: a later policy edit cannot change what this one was.
    const lastRule = chain.levels[chain.levels.length - 1];
    const completesChain = decision === 'APPROVE' && !!lastRule && lastRule.level === levelNumber;
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.approvalDecision.create({
        data: {
          companyId: actor.companyId,
          policyId: chain.policyId,
          entityType,
          entityId,
          level: levelNumber,
          decision,
          cycle,
          reason,
          actorId: actor.userId,
          actorRoleCode: roleCode,
        },
        });
        if (requestKey) await tx.$executeRaw`UPDATE approval_decisions SET "requestKey"=${requestKey}, "requestHash"=${fingerprint}, "completesChain"=${completesChain} WHERE id=${row.id}::uuid`;
        return row;
      });
    } catch (error) {
      // The unique index on (company, entity, level) for approvals is the
      // race-safe answer to two people clicking at once. The loser is told
      // why rather than shown a database error.
      const code = (error as { code?: unknown }).code;
      const uniqueViolation =
        code === 'P2002' ||
        code === '23505' ||
        (error instanceof Error && /unique constraint/i.test(error.message));
      if (uniqueViolation && requestKey) {
        const winner = await this.keyedDecision(actor.companyId, entityType, entityId, requestKey);
        if (winner && winner.actorId === actor.userId && winner.decision === decision && winner.requestHash === fingerprint) {
          const replayState = await this.stateFor(actor.companyId, chain, entityType, entityId, params.since ?? null);
          return { decision: winner, ...replayState, replayed: true };
        }
        if (winner) throw new ConflictException({ code: 'APPROVAL_KEY_REUSED', message: 'Idempotency key was reused for a different approval decision' });
      }
      if (uniqueViolation && decision === 'APPROVE') {
        throw new ConflictException({ code: 'APPROVAL_LEVEL_DECIDED_ELSEWHERE', message: 'This level was approved by somebody else a moment ago; reload the request' });
      }
      throw error;
    }
    await this.audit.record({
      companyId: actor.companyId,
      userId: actor.userId,
      action: `APPROVAL_${decision}`,
      entity: DECISIONS,
      entityId: created.id,
      after: { entityType, entityId, level: levelNumber, reason },
    });
    const after = await this.stateFor(actor.companyId, chain, entityType, entityId, since);
    return { decision: created, ...after };
  }

  /// The decision history for one document, for the screen that shows the
  /// path it took.
  /// Branches a document of this type belongs to, or undefined when the type
  /// has no known branch owner (a branch-limited caller then sees nothing).
  async entityBranches(companyId: string, entityType: string, entityId: string): Promise<string[] | undefined> {
    if (entityType === 'StockTransfer') {
      const row = await this.prisma.stockTransfer.findFirst({
        where: { id: entityId, companyId },
        select: { sourceBranchId: true, destinationBranchId: true },
      });
      return row ? [row.sourceBranchId, row.destinationBranchId] : [];
    }
    return undefined;
  }

  async history(companyId: string, entityType: string, entityId: string, branchScope: string[] | null = null) {
    if (branchScope) {
      const owners = await this.entityBranches(companyId, entityType, entityId);
      // Same rule as the transfer screens: every branch of the document must be
      // inside the caller's scope. Unknown types are hidden from branch staff.
      if (!owners || owners.length === 0 || !owners.every((id) => branchScope.includes(id))) {
        throw new NotFoundException({ code: 'APPROVAL_HISTORY_NOT_FOUND', message: 'Approval history not found' });
      }
    }
    const rows = await this.prisma.approvalDecision.findMany({
      where: { companyId, entityType, entityId },
      orderBy: [{ createdAt: 'asc' }, { level: 'asc' }],
      select: {
        id: true,
        level: true,
        decision: true,
        reason: true,
        actorId: true,
        actorRoleCode: true,
        createdAt: true,
        policy: { select: { id: true, nameEn: true, nameAr: true } },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        level: row.level,
        decision: row.decision,
        reason: row.reason,
        actorId: row.actorId,
        actorRoleCode: row.actorRoleCode,
        createdAt: row.createdAt,
        policy: row.policy,
      })),
    };
  }
}
