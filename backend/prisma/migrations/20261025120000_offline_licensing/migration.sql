-- Offline licensing: the installation's licence, the keys it has accepted,
-- the seat ledger, and the licence's own history.
--
-- Additive only. No existing table is altered and no existing row is
-- rewritten. The one data statement at the end is a backfill: every user
-- account that already exists is recorded as an already-consumed seat, so a
-- licence issued with, say, five seats cannot be turned into five extra
-- accounts by ignoring the accounts that were there before it.

CREATE TABLE "license_installations" (
    "id" UUID NOT NULL,
    "licenseId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "customerRef" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "seatLimit" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastKeyId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "clockState" TEXT NOT NULL DEFAULT 'OK',
    "clockNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_installations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "license_installations_licenseId_key" ON "license_installations"("licenseId");

CREATE TABLE "license_keys" (
    "id" UUID NOT NULL,
    "keyId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "machineId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" UUID,
    "ipAddress" TEXT,
    "note" TEXT,

    CONSTRAINT "license_keys_pkey" PRIMARY KEY ("id")
);

-- The uniqueness is the anti-replay rule: one key, one grant.
CREATE UNIQUE INDEX "license_keys_keyId_key" ON "license_keys"("keyId");
CREATE INDEX "license_keys_licenseId_idx" ON "license_keys"("licenseId");

CREATE TABLE "license_seat_usage" (
    "id" UUID NOT NULL,
    "licenseId" TEXT,
    "userId" UUID,
    "username" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_seat_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "license_seat_usage_idempotencyKey_key" ON "license_seat_usage"("idempotencyKey");
CREATE INDEX "license_seat_usage_licenseId_idx" ON "license_seat_usage"("licenseId");
CREATE INDEX "license_seat_usage_userId_idx" ON "license_seat_usage"("userId");

CREATE TABLE "license_events" (
    "id" UUID NOT NULL,
    "licenseId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "license_events_licenseId_occurredAt_idx" ON "license_events"("licenseId", "occurredAt");

-- Backfill: the accounts already on this installation are already-created
-- accounts. They stay active, keep their roles and passwords, and are simply
-- counted. `licenseId` is null because no licence row exists yet; the first
-- activation adopts these rows without creating new ones.
-- The id is generated here because, unlike the other columns, it has no
-- default: the application always supplies it (@uuid()). Without this the
-- statement fails on every installation that has accounts, which is every
-- installation that is upgrading.
INSERT INTO "license_seat_usage" ("id", "userId", "username", "reason", "idempotencyKey", "createdAt")
SELECT gen_random_uuid(), u."id", u."username", 'MIGRATION_EXISTING', 'migration:' || u."id"::text, u."createdAt"
FROM "users" u
ON CONFLICT ("idempotencyKey") DO NOTHING;
