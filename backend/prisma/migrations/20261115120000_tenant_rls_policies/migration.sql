-- Tenant row-level security: every public table is scoped to exactly one
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

-- ---------------------------------------------------------------------------
-- Generic tenant scope: "companyId" = app_company_id(), deny when unset
-- ---------------------------------------------------------------------------
ALTER TABLE public."branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."branches"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."user_profile_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_profile_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."user_profile_photos"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."accounts"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journal_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."journal_entries"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cost_centers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."cost_centers"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."fixed_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."fixed_assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."fixed_assets"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."depreciation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."depreciation_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."depreciation_runs"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."asset_depreciations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."asset_depreciations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."asset_depreciations"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."company_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."company_settings"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."cash_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cash_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."cash_accounts"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."cash_vouchers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cash_vouchers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."cash_vouchers"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."cash_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cash_transfers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."cash_transfers"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."bank_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."bank_reconciliations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."bank_reconciliations"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."opening_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."opening_balances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."opening_balances"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."stock_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."stock_documents"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."stock_document_creation_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_document_creation_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."stock_document_creation_requests"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."document_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."document_sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."document_sequences"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."customers"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."suppliers"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."fiscal_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."fiscal_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."fiscal_periods"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."items"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."stock_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_balances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."stock_balances"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."stock_movements"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."sales_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sales_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."sales_invoices"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."purchase_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."purchase_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."purchase_invoices"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."quotation_term_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotation_term_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotation_term_templates"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."quotation_column_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotation_column_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotation_column_templates"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."quotation_design_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotation_design_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotation_design_templates"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."quotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotations"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."quotations_legacy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotations_legacy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotations_legacy"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."stock_voucher_edit_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_voucher_edit_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."stock_voucher_edit_requests"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."item_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."item_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."item_categories"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."warehouses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."warehouses"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."purchase_orders"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."sales_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sales_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."sales_orders"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."price_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."price_lists" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."price_lists"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."budgets"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."order_creation_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."order_creation_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."order_creation_requests"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."storage_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."storage_locations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."storage_locations"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."item_warehouse_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."item_warehouse_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."item_warehouse_settings"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."item_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."item_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."item_batches"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."item_cost_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."item_cost_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."item_cost_history"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."warehouse_stock_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."warehouse_stock_balances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."warehouse_stock_balances"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."user_warehouse_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_warehouse_access" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."user_warehouse_access"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."stock_take_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_take_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."stock_take_sessions"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."notifications"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."notification_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."notification_settings"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."print_price_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."print_price_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."print_price_settings"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

ALTER TABLE public."item_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."item_images" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."item_images"
  FOR ALL
  USING ("companyId" = public.app_company_id())
  WITH CHECK ("companyId" = public.app_company_id());

-- ---------------------------------------------------------------------------
-- Child tables: scope inherited from the owning parent row
-- ---------------------------------------------------------------------------
ALTER TABLE public."journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journal_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."journal_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_lines."journalEntryId" AND je."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = journal_lines."journalEntryId" AND je."companyId" = public.app_company_id()));

ALTER TABLE public."journal_line_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."journal_line_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."journal_line_allocations"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.journal_lines jl JOIN public.journal_entries je ON je.id = jl."journalEntryId" WHERE jl.id = journal_line_allocations."journalLineId" AND je."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.journal_lines jl JOIN public.journal_entries je ON je.id = jl."journalEntryId" WHERE jl.id = journal_line_allocations."journalLineId" AND je."companyId" = public.app_company_id()));

ALTER TABLE public."cash_voucher_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."cash_voucher_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."cash_voucher_allocations"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.cash_vouchers cv WHERE cv.id = cash_voucher_allocations."voucherId" AND cv."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cash_vouchers cv WHERE cv.id = cash_voucher_allocations."voucherId" AND cv."companyId" = public.app_company_id()));

ALTER TABLE public."opening_balance_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."opening_balance_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."opening_balance_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.opening_balances ob WHERE ob.id = opening_balance_lines."openingBalanceId" AND ob."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.opening_balances ob WHERE ob.id = opening_balance_lines."openingBalanceId" AND ob."companyId" = public.app_company_id()));

ALTER TABLE public."stock_document_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_document_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."stock_document_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.stock_documents sd WHERE sd.id = stock_document_lines."documentId" AND sd."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stock_documents sd WHERE sd.id = stock_document_lines."documentId" AND sd."companyId" = public.app_company_id()));

ALTER TABLE public."sales_invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sales_invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."sales_invoice_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.id = sales_invoice_lines."invoiceId" AND si."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.id = sales_invoice_lines."invoiceId" AND si."companyId" = public.app_company_id()));

ALTER TABLE public."purchase_invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."purchase_invoice_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."purchase_invoice_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.purchase_invoices pi WHERE pi.id = purchase_invoice_lines."invoiceId" AND pi."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_invoices pi WHERE pi.id = purchase_invoice_lines."invoiceId" AND pi."companyId" = public.app_company_id()));

ALTER TABLE public."quotation_tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotation_tables" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotation_tables"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_tables."quotationId" AND q."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_tables."quotationId" AND q."companyId" = public.app_company_id()));

ALTER TABLE public."quotation_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotation_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotation_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.quotation_tables qt JOIN public.quotations q ON q.id = qt."quotationId" WHERE qt.id = quotation_lines."tableId" AND q."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotation_tables qt JOIN public.quotations q ON q.id = qt."quotationId" WHERE qt.id = quotation_lines."tableId" AND q."companyId" = public.app_company_id()));

ALTER TABLE public."quotation_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotation_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotation_events"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_events."quotationId" AND q."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_events."quotationId" AND q."companyId" = public.app_company_id()));

ALTER TABLE public."quotation_lines_legacy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."quotation_lines_legacy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."quotation_lines_legacy"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.quotations_legacy ql WHERE ql.id = quotation_lines_legacy."quotationId" AND ql."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.quotations_legacy ql WHERE ql.id = quotation_lines_legacy."quotationId" AND ql."companyId" = public.app_company_id()));

ALTER TABLE public."item_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."item_units" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."item_units"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.items i WHERE i.id = item_units."itemId" AND i."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.items i WHERE i.id = item_units."itemId" AND i."companyId" = public.app_company_id()));

ALTER TABLE public."purchase_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."purchase_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."purchase_order_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_lines."orderId" AND po."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_lines."orderId" AND po."companyId" = public.app_company_id()));

ALTER TABLE public."sales_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sales_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."sales_order_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.sales_orders so WHERE so.id = sales_order_lines."orderId" AND so."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_orders so WHERE so.id = sales_order_lines."orderId" AND so."companyId" = public.app_company_id()));

ALTER TABLE public."price_list_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."price_list_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."price_list_items"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.price_lists pl WHERE pl.id = price_list_items."priceListId" AND pl."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.price_lists pl WHERE pl.id = price_list_items."priceListId" AND pl."companyId" = public.app_company_id()));

ALTER TABLE public."stock_take_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."stock_take_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_company ON public."stock_take_lines"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.stock_take_sessions sts WHERE sts.id = stock_take_lines."sessionId" AND sts."companyId" = public.app_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stock_take_sessions sts WHERE sts.id = stock_take_lines."sessionId" AND sts."companyId" = public.app_company_id()));

-- ---------------------------------------------------------------------------
-- companies: the tenant root. Readable during the reviewed login and setup
-- paths; writable only by its own context (setup may create the first row).
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
CREATE POLICY companies_select ON public.companies
  FOR SELECT
  USING (id = public.app_company_id() OR public.app_login_mode() OR public.app_setup_mode());
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
