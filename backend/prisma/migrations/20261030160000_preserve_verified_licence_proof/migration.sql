-- Additive and nullable: existing records have no recoverable signature and
-- must never be treated as signed merely because their payload JSON exists.
ALTER TABLE "license_keys" ADD COLUMN "signedKey" TEXT;
