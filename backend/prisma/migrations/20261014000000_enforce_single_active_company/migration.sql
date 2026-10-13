-- The product supports company-scoped data but each installation has one
-- active company. Setup checks this in application code; this partial unique
-- index makes the invariant race-safe across concurrent setup requests and
-- across multiple API processes.
CREATE UNIQUE INDEX "Company_one_active_company_idx"
ON "Company" ((1))
WHERE "deletedAt" IS NULL;
