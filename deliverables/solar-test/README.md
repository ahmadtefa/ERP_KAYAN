# KAYAN-SOLAR-TEST (كيان للطاقة الشمسية) - fictional test dataset

Fully fictional data, EGP. Created through the system's own HTTP API on an independent PostgreSQL 14 (not Supabase, not production).
Dump: `KAYAN-SOLAR-TEST.dump` (PGDMP custom format, made by the program's own `POST /backup/full/database-archive`). SHA-256: 172e2b97a6fb25713c9da89783707a3df392ce904f61b7646e9ff5b227943222

Restore: `POST /backup/full/restore?confirm=true` with the file (verified, see restore-test-result.json).

Counts: 5 branches, 12 warehouses (+5 system transit warehouses), 300 items, 200 customers, 50 suppliers, 15 users + admin, 10 cost centers,
500 sales invoices (480 posted incl. 10 reversed, 20 draft), 200 purchase invoices (192 posted, 8 draft), 100 stock transfers
(55 closed, 15 dispatched, 10 approved, 10 pending approval, 5 draft, 5 rejected), 4288 stock movements, 1331 journal entries (balanced, debit = credit = 823,731,473.8247),
543 cash vouchers, 1 two-level approval policy, 480 item thresholds, 1200 notifications (incl. warehouse stock alerts). No negative stock.

No passwords are stored in this repository. Test-user logins are delivered separately.
generator/ holds the scripts used (stage1, 2a, 2b, 2c, fixcap, stage3).
