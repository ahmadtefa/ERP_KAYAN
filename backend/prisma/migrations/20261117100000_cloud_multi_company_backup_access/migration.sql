DROP INDEX IF EXISTS public."Company_one_active_company_idx";

DO $$
DECLARE
  target_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kayan_migrator') THEN
    FOR target_table IN
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = target_table
          AND policyname = 'backup_select_migrator'
      ) THEN
        EXECUTE format(
          'CREATE POLICY backup_select_migrator ON public.%I FOR SELECT TO kayan_migrator USING (true)',
          target_table
        );
      END IF;
    END LOOP;
  END IF;
END
$$;
