# KAYAN-SOLAR-TEST (كيان للطاقة الشمسية) - fictional test dataset

Fully fictional data, EGP. Created through the system's own HTTP API on an independent PostgreSQL 14 (not Supabase, not production).
Dump: `KAYAN-SOLAR-TEST.dump` (PGDMP custom format, made by the program's own `POST /backup/full/database-archive`). SHA-256: 0f874988b9bbb75b63a79c1cd5c653723de33daa4570cae3f208e246d724402c

Restore: `POST /backup/full/restore?confirm=true` with the file (verified, see restore-test-result.json).

Counts: 5 branches, 12 warehouses (+5 system transit warehouses), 300 items, 200 customers, 50 suppliers, 15 users in total including the admin (16 originally; the unused `reports` user was removed by direct SQL delete because the program has no user-delete route, then the dump and restore were re-verified), 10 cost centers,
500 sales invoices (480 posted incl. 10 reversed, 20 draft), 200 purchase invoices (192 posted, 8 draft), 100 stock transfers
(55 closed, 15 dispatched, 10 approved, 10 pending approval, 5 draft, 5 rejected), 4288 stock movements, 1331 journal entries (balanced, debit = credit = 823,731,473.8247),
543 cash vouchers, 1 two-level approval policy, 480 item thresholds, 1200 notifications (incl. warehouse stock alerts). No negative stock.

No passwords are stored in this repository. Test-user logins are delivered separately.
generator/ holds the scripts used (stage1, 2a, 2b, 2c, fixcap, stage3).

Generator scripts take DB and user passwords from the environment (KAYAN_PG_PASSWORD) or generate them randomly; none are stored here.
Note: an earlier commit on this branch (766ccc27) contained throwaway local-only literals in the generator (local test DB password, CI restore-user password, build JWT secrets). They were removed from the current files in the following commit but remain in branch history. Not real accounts.

JSON: `KAYAN-SOLAR-TEST.json` is the program's company backup (`GET /backup/download`, format kayan-backup v1, ~20 MB, under the 64 MB restore limit). Restore: `POST /backup/restore?replace=true` into an installation with the same company code (KAYAN-SOLAR). Verified: see json-restore-test-result.json (generator/stage4.mjs).
