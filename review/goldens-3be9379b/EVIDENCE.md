# Evidence — run 42863594410 (commit a84a0200)

## 1. Why safe-checks fails: two jobs, two different causes

| job | step | result | cause |
| --- | --- | --- | --- |
| Flutter analyze and tests | `flutter analyze --no-pub` | success | analysis is clean |
| Flutter analyze and tests | `Run Flutter tests and report failures` | **failure** | 3 golden pixel comparisons |
| Flutter analyze and tests | `flutter build web --release` | skipped | skipped because the step above failed |
| Licence store integration blocked | `Require approved isolated licence-test VM` | **failure** | `exit 1` hard-coded gate |
| Licence store integration blocked | `Run the unchanged licence store integration test` | skipped | the test never ran |

The licence job is a deliberate gate, not a test result. Its own message says:
"Approved isolated test VM and runner trust controls are not configured. This is
not a test pass or release approval." It fails on every run, including runs
where nothing else failed.

Every other job is green: Backend focused, Native Prisma and PostgreSQL 16
upgrade, Synthetic screenshot preview, and the three Full-resolution synthetic
review jobs.

## 2. The three failing tests, by name

Until commit `a84a0200` the run reported `failed=3` but named only two tests,
because `sales invoices section selected (Arabic RTL)` produced no error event
and the merged annotation stopped after the two that did. Each failing test is
now announced by name in its own notice. The published names are:

1. `screenshot: dashboard inside the shell (Arabic RTL)` — 1.41%, 18273px
2. `screenshot: customers section selected (Arabic RTL)` — 3.10%, 40154px
3. `screenshot: sales invoices section selected (Arabic RTL)` — measured below

## 3. Reconstruction integrity

The three renders were rebuilt from the lossless WebP chunks in the check-run
annotations of run 42863594410. For each file the decoded 1440x900 RGBA hash was
compared with the hash the runner published before uploading:

| file | decoded size | RGBA hash matched |
| --- | --- | --- |
| dashboard_ar.png | 1440x900 | yes |
| customers_ar.png | 1440x900 | yes |
| sales_invoices_ar.png | 1440x900 | yes |

## 4. Region diff against the committed baselines

| screen | differing pixels | % of full image | differing columns | content area x<1191 | sidebar x>=1191 |
| --- | --- | --- | --- | --- | --- |
| dashboard | 18,273 | 1.41% | 1192..1421 | **0 px** | 18,273 px |
| customers | 40,154 | 3.10% | 1192..1429 | **0 px** | 40,154 px |
| sales_invoices | 41,395 | 3.19% | 1191..1429 | **0 px** | 41,395 px |

The navigation sidebar occupies the right 290 columns in this RTL layout. In all
three screens **not one pixel** differs outside it: no colour, typography,
spacing, direction or content change.

Inside the sidebar the change is the accordion and nothing else. The before/after
strips in this directory show the same eight sections in the same order with the
same membership:

| section | entries | unchanged |
| --- | --- | --- |
| overview | 1 | yes |
| accounting | 8 | yes |
| parties | 2 | yes |
| inventory | 11 | yes |
| sales | 4 | yes |
| purchases | 3 | yes |
| insights | 1 | yes |
| administration | 5 | yes |

`git diff 4f4ea565..HEAD -- lib/app/shell/erp_shell.dart` contains no change to
the `_NavGroup` enum, to any `group:` assignment, or to any `AppRoutes.` entry in
the menu. The only structural change is how the open section is stored: a `Set`
of collapsed sections became a single open section.

## 5. What is deliberately not done

The committed baselines under `test/screenshots/goldens/` are unchanged. These
renders are review material. Replacing a baseline is a separate decision that
follows review of these files, not a step taken to make CI green.
