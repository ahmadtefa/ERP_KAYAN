#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regenerates prisma/migrations/20261115120000_tenant_rls_policies/migration.sql.

Kept in the repo so the policy set can be re-derived and reviewed. The
migration file itself is the source of truth applied to databases; run this
only when the table classification changes.
"""
import io, os

out = io.StringIO()
W = out.write

W("""-- Tenant row-level security: every public table is scoped to exactly one
-- company, enforced inside PostgreSQL so no application bug or leaked query
-- can cross that boundary.
--
-- Context protocol (the ONLY sanctioned way to carry tenant identity into a
-- database session):
--   SELECT set_config('app.company_id', '<uuid>', true);   -- transaction-local
--   SELECT set_config('app.login_mode', '1', true);        -- reviewed login path
--   SELECT set_config('app.setup_mode', '1', true);        -- reviewed bootstrap path
-- All three are transaction-local (the third argument is `true`), so they can
-- never leak to the next query that borrows the pooled connection. Unset
-- context means "no tenant": every tenant policy denies by default.
--
-- Roles: the runtime application role is NOSUPERUSER NOBYPASSRLS and is
-- subject to these policies. The migration role owns the tables but FORCE
-- ROW LEVEL SECURITY subjects the owner too, so data fixes inside future
-- migrations must set app.company_id explicitly. Local Windows installs keep
-- running as a superuser where RLS does not apply, unchanged.
--
-- SYSTEM OBJECT EXCEPTIONS (documented, deliberate):
--   * permissions: shared system catalog (read/write to any application
--     session; contains no tenant data).
--   * license_installations / license_keys / license_seat_usage / license_events:
--     device-level licence records, not tenant rows; only the application role
--     holds grants.
--   * audit_logs / backup_runs: rows with NULL companyId are system-level
--     events, visible to every tenant context (writes may set NULL or the
--     session company).
--   * roles: rows with NULL companyId are system roles shared by all
--     companies - readable everywhere, writable only inside a tenant context.
--
-- This migration contains no role/extension DDL, no destructive statements and
-- no SECURITY DEFINER functions; it passes backend/scripts/supabase-migration-audit.mjs.

-- ---------------------------------------------------------------------------
-- Context readers
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.app_company_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;

CREATE FUNCTION public.app_login_mode() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.login_mode', true) = '1', false) $$;

CREATE FUNCTION public.app_setup_mode() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.setup_mode', true) = '1', false) $$;

-- System jobs (schedulers) read the company roster in this mode and NOTHING
-- else: only companies_select honours it. The job's real work then runs in a
-- strict per-company context (app.company_id), so this mode never carries
-- tenant business data.
CREATE FUNCTION public.app_jobs_mode() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.jobs_mode', true) = '1', false) $$;

-- ---------------------------------------------------------------------------
-- Generic tenant scope: "companyId" = app_company_id(), deny when unset
-- ---------------------------------------------------------------------------
""")

direct = ['branches', 'user_profile_photos', 'accounts', 'journal_entries',
 'cost_centers', 'fixed_assets', 'depreciation_runs', 'asset_depreciations',
 'company_settings', 'cash_accounts', 'cash_vouchers', 'cash_transfers',
 'bank_reconciliations', 'opening_balances', 'stock_documents',
 'stock_document_creation_requests', 'document_sequences', 'customers',
 'suppliers', 'fiscal_periods', 'items', 'stock_balances', 'stock_movements',
 'sales_invoices', 'purchase_invoices', 'quotation_term_templates',
 'quotation_column_templates', 'quotation_design_templates', 'quotations',
 'quotations_legacy', 'stock_voucher_edit_requests', 'item_categories',
 'warehouses', 'purchase_orders', 'sales_orders', 'price_lists', 'budgets',
 'order_creation_requests', 'storage_locations', 'item_warehouse_settings',
 'item_batches', 'item_cost_history', 'warehouse_stock_balances',
 'user_warehouse_access', 'stock_take_sessions', 'notifications',
 'notification_settings', 'print_price_settings', 'item_images']

for t in direct:
    W(f"""ALTER TABLE public."{t}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."{t}" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."{t}"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

""")

W("""-- ---------------------------------------------------------------------------
-- Child tables: scope inherited from the owning parent row
-- ---------------------------------------------------------------------------
""")

children = [
 ('journal_lines', 'EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_lines."journalEntryId" AND je."companyId" = public.app_company_id())'),
 ('journal_line_allocations', 'EXISTS (SELECT 1 FROM public.journal_lines jl JOIN public.journal_entries je ON je.id = jl."journalEntryId" WHERE jl.id = journal_line_allocations."journalLineId" AND je."companyId" = public.app_company_id())'),
 ('cash_voucher_allocations', 'EXISTS (SELECT 1 FROM public.cash_vouchers cv WHERE cv.id = cash_voucher_allocations."voucherId" AND cv."companyId" = public.app_company_id())'),
 ('opening_balance_lines', 'EXISTS (SELECT 1 FROM public.opening_balances ob WHERE ob.id = opening_balance_lines."openingBalanceId" AND ob."companyId" = public.app_company_id())'),
 ('stock_document_lines', 'EXISTS (SELECT 1 FROM public.stock_documents sd WHERE sd.id = stock_document_lines."documentId" AND sd."companyId" = public.app_company_id())'),
 ('sales_invoice_lines', 'EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.id = sales_invoice_lines."invoiceId" AND si."companyId" = public.app_company_id())'),
 ('purchase_invoice_lines', 'EXISTS (SELECT 1 FROM public.purchase_invoices pi WHERE pi.id = purchase_invoice_lines."invoiceId" AND pi."companyId" = public.app_company_id())'),
 ('quotation_tables', 'EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_tables."quotationId" AND q."companyId" = public.app_company_id())'),
 ('quotation_lines', 'EXISTS (SELECT 1 FROM public.quotation_tables qt JOIN public.quotations q ON q.id = qt."quotationId" WHERE qt.id = quotation_lines."tableId" AND q."companyId" = public.app_company_id())'),
 ('quotation_events', 'EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_events."quotationId" AND q."companyId" = public.app_company_id())'),
 ('quotation_lines_legacy', 'EXISTS (SELECT 1 FROM public.quotations_legacy ql WHERE ql.id = quotation_lines_legacy."quotationId" AND ql."companyId" = public.app_company_id())'),
 ('item_units', 'EXISTS (SELECT 1 FROM public.items i WHERE i.id = item_units."itemId" AND i."companyId" = public.app_company_id())'),
 ('purchase_order_lines', 'EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_lines."orderId" AND po."companyId" = public.app_company_id())'),
 ('sales_order_lines', 'EXISTS (SELECT 1 FROM public.sales_orders so WHERE so.id = sales_order_lines."orderId" AND so."companyId" = public.app_company_id())'),
 ('price_list_items', 'EXISTS (SELECT 1 FROM public.price_lists pl WHERE pl.id = price_list_items."priceListId" AND pl."companyId" = public.app_company_id())'),
 ('stock_take_lines', 'EXISTS (SELECT 1 FROM public.stock_take_sessions sts WHERE sts.id = stock_take_lines."sessionId" AND sts."companyId" = public.app_company_id())'),
]

for t, cond in children:
    W(f"""ALTER TABLE public."{t}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."{t}" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."{t}"
  FOR ALL
  USING ({cond})
  WITH CHECK ({cond});

""")

W("""-- ---------------------------------------------------------------------------
-- companies: the tenant root. Readable during the reviewed login, setup, and
-- system-jobs roster paths; writable only by its own context (setup may create
-- the first row). The jobs mode opens SELECT on this table and nothing else.
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_select ON public.companies
  FOR SELECT
  USING (id = public.app_company_id() OR public.app_login_mode() OR public.app_setup_mode() OR public.app_jobs_mode());
CREATE POLICY companies_insert ON public.companies
  FOR INSERT
  WITH CHECK (public.app_setup_mode() OR id = public.app_company_id());
CREATE POLICY companies_update ON public.companies
  FOR UPDATE
  USING (id = public.app_company_id() OR public.app_setup_mode())
  WITH CHECK (id = public.app_company_id() OR public.app_setup_mode());

-- ---------------------------------------------------------------------------
-- users: login resolves a user by username BEFORE a company context exists,
-- so SELECT is allowed in reviewed login/setup mode only; everything else
-- stays strictly tenant-scoped.
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_select ON public.users
  FOR SELECT
  USING ("companyId" = public.app_company_id() OR public.app_login_mode() OR public.app_setup_mode());
CREATE POLICY users_insert ON public.users
  FOR INSERT
  WITH CHECK ("companyId" = public.app_company_id() OR public.app_setup_mode());
CREATE POLICY users_update ON public.users
  FOR UPDATE
  USING ("companyId" = public.app_company_id() OR public.app_setup_mode())
  WITH CHECK ("companyId" = public.app_company_id() OR public.app_setup_mode());
CREATE POLICY users_delete ON public.users
  FOR DELETE
  USING ("companyId" = public.app_company_id());

-- ---------------------------------------------------------------------------
-- Access-control children of users. user_roles carries its own companyId;
-- the others inherit it from their user. SELECT is login/setup-aware so the
-- permission snapshot can be assembled during sign-in; writes stay strict.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_roles_select ON public.user_roles
  FOR SELECT
  USING ("companyId" = public.app_company_id() OR public.app_login_mode() OR public.app_setup_mode());
CREATE POLICY user_roles_write ON public.user_roles
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY user_permissions_select ON public.user_permissions
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_permissions."userId"
    AND (u."companyId" = public.app_company_id() OR public.app_login_mode() OR public.app_setup_mode())));
CREATE POLICY user_permissions_write ON public.user_permissions
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_permissions."userId" AND u."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_permissions."userId" AND u."companyId" = public.app_company_id()));

ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY user_branches_select ON public.user_branches
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_branches."userId"
    AND (u."companyId" = public.app_company_id() OR public.app_login_mode() OR public.app_setup_mode())));
CREATE POLICY user_branches_write ON public.user_branches
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_branches."userId" AND u."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_branches."userId" AND u."companyId" = public.app_company_id()));

-- ---------------------------------------------------------------------------
-- roles: NULL companyId marks a system role shared by every company - visible
-- everywhere, writable only inside its own tenant context.
-- ---------------------------------------------------------------------------
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_select ON public.roles
  FOR SELECT
  USING ("companyId" = public.app_company_id() OR "companyId" IS NULL
    OR public.app_login_mode() OR public.app_setup_mode());
CREATE POLICY roles_insert ON public.roles
  FOR INSERT
  WITH CHECK ("companyId" = public.app_company_id() OR public.app_setup_mode());
CREATE POLICY roles_update ON public.roles
  FOR UPDATE
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());
CREATE POLICY roles_delete ON public.roles
  FOR DELETE
  USING ("companyId" = public.app_company_id());

-- ---------------------------------------------------------------------------
-- role_permissions: follow the role; system-role grants (NULL company) are a
-- readable catalog, writable only through a tenant-owned role.
-- ---------------------------------------------------------------------------
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select ON public.role_permissions
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = role_permissions."roleId"
    AND (r."companyId" = public.app_company_id() OR r."companyId" IS NULL
      OR public.app_login_mode() OR public.app_setup_mode())));
CREATE POLICY role_permissions_write ON public.role_permissions
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = role_permissions."roleId"
    AND r."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.roles r WHERE r.id = role_permissions."roleId"
    AND r."companyId" = public.app_company_id()));

-- ---------------------------------------------------------------------------
-- refresh_tokens: authentication material. Readable/writable in reviewed
-- login mode so the refresh flow can resolve and rotate a token before a
-- company context exists; afterwards the owning user's tenant applies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_all ON public.refresh_tokens
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = refresh_tokens."userId"
    AND (u."companyId" = public.app_company_id() OR public.app_login_mode())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = refresh_tokens."userId"
    AND (u."companyId" = public.app_company_id() OR public.app_login_mode())));

-- ---------------------------------------------------------------------------
-- audit_logs / backup_runs: NULL companyId rows are system-level records,
-- visible to every context; a context may also manage its own rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_company ON public.audit_logs
  FOR ALL
  USING ("companyId" = public.app_company_id() OR "companyId" IS NULL)
  WITH CHECK ("companyId" = public.app_company_id() OR "companyId" IS NULL);

ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY backup_runs_company ON public.backup_runs
  FOR ALL
  USING ("companyId" = public.app_company_id() OR "companyId" IS NULL)
  WITH CHECK ("companyId" = public.app_company_id() OR "companyId" IS NULL);

-- ---------------------------------------------------------------------------
-- SYSTEM OBJECT EXCEPTIONS (see header): shared catalog and device-level
-- licence records carry no tenant column and are protected by role grants
-- (only the application role holds DML) rather than by company policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY permissions_catalog ON public.permissions
  FOR ALL
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.license_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_installations FORCE ROW LEVEL SECURITY;
CREATE POLICY license_device_records ON public.license_installations
  FOR ALL
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY license_device_records ON public.license_keys
  FOR ALL
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.license_seat_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_seat_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY license_device_records ON public.license_seat_usage
  FOR ALL
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.license_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_events FORCE ROW LEVEL SECURITY;
CREATE POLICY license_device_records ON public.license_events
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Supabase Data-API roles (anon/authenticated) must hold NO table privileges:
-- all access goes through the dedicated runtime role, not PostgREST.
-- The DO blocks keep this migration valid on plain PostgreSQL, where those
-- roles do not exist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;
""")

here = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(here, '..', 'prisma', 'migrations',
                    '20261115120000_tenant_rls_policies', 'migration.sql')
with open(path, 'w') as f:
    f.write(out.getvalue())
print('written', path, len(out.getvalue().splitlines()), 'lines')
