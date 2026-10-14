-- Manual journal entries may be posted after approval. Keep the database
-- transition guard aligned with JournalEntriesService.post(), which accepts
-- both DRAFT and APPROVED entries. Business-document journals are inserted
-- directly as POSTED and are unaffected by this UPDATE-only trigger.
CREATE OR REPLACE FUNCTION kayan_validate_journal_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'POSTED'::"JournalStatus"
       AND OLD.status NOT IN ('DRAFT'::"JournalStatus", 'APPROVED'::"JournalStatus") THEN
      RAISE EXCEPTION 'Journal entry is no longer draft or approved'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'REVERSED'::"JournalStatus"
       AND OLD.status <> 'POSTED'::"JournalStatus" THEN
      RAISE EXCEPTION 'Only a posted journal entry can be reversed'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
