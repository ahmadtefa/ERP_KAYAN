# KAYAN ERP — design rules

A design brief for AI design tools (Google Stitch, and any designer or agent
working on this project). Upload or paste this file into the tool first, so
every screen it generates belongs to the same product.

The program is an Arabic-first accounting and inventory system used from a
browser. It is a working tool, not a marketing site: people sit in front of it
for a whole working day, entering invoices and reading numbers.

---

## 1. The product in one paragraph

KAYAN ERP is a multi-user accounting program. One server holds the company's
ledger, stock, customers, suppliers and invoices; every user opens it in a
browser. A typical working screen is a **dense table of real records** with a
search box, a primary action, and a way to download the list as Excel, CSV or
PDF. Around those tables sit journal entries, the chart of accounts, the fiscal
period, reports, data import, backup, user administration, and settings.

Two languages, fully mirrored: **Arabic (right to left) and English (left to
right)**. Every label comes from a translation file, so never bake text into a
layout — leave room for a longer Arabic word in the same slot.

---

## 2. Colour

| Role | Value | Notes |
|---|---|---|
| Primary (seed) | `#0B6E4F` | A deep accountant's green. The whole palette is derived from this one colour, Material 3 style. |
| Surfaces | near-white, not pure white | The page background is a very light neutral; cards and tables sit on it. |
| Text | near-black on light | Never grey-on-grey for numbers. |
| Borders | one step darker than the surface | Hairlines divide table rows; there are no shadows. |
| Negative amounts | a muted red | Loans, liabilities, losses. |
| Positive amounts | the primary green | Assets, profit. |

Rules:

- **One accent colour only.** No second brand colour, no gradients, no glows.
- **No drop shadows** on cards, tables or headers. Separation comes from
  hairlines and spacing.
- Amounts, codes and dates read in a **tabular (fixed-width) figure style**, so
  columns of numbers line up digit under digit.
- Western digits (0-9) in both languages. Never Eastern Arabic numerals.

---

## 3. Type

- System font. On Windows that is Segoe UI; the Arabic face is the system
  Arabic font. Do not propose a web font that must be downloaded.
- One family, four sizes: **page title** (large, medium weight), **section
  label**, **body/table cell** (the workhorse), **caption** (timestamps,
  hints, row counts) — the caption is the only small text.
- Table cells are regular weight. Headers are slightly heavier and a touch
  smaller, and may be uppercase in English.
- Numbers are never bolded to show importance; importance is a column, an
  order, or a total row with a light background.

---

## 4. Layout

- Desktop first, 1440 × 900 is the design canvas. It must still be usable at
  1366 × 768, which is the smallest laptop in the office.
- **A permanent left navigation rail** (~230 px) lists the modules in the order
  people use them: Dashboard, Journal entries, Fiscal periods, Customers,
  Suppliers, Items, Stock, Sales invoices, Purchase invoices, Chart of
  accounts, Reports, Import from a file, Backup and restore, Administration,
  Settings. The current item is marked with a soft filled pill behind its icon
  and label. On a narrow screen the rail becomes a drawer.
- **Content area**: a header row, then the content.
  - Header row, left: the screen's title.
  - Header row, right: the filters that belong to this screen — a search field,
    a status dropdown, a **Download the list** menu — and the screen's primary
    action as a filled button (for example "New item" or "New customer").
  - The **Download the list** control is one button that opens a small menu of
    four choices: Excel, CSV, PDF, Print. It appears on every screen that shows
    a table.
- **Tables** are the main object. Row height comfortable for reading, hairline
  separators, no zebra striping. The last column holds row actions as two small
  icons (edit, deactivate) that stay quiet until the row is hovered.
- Right to left: the rail moves to the right edge, the title to the right, the
  primary action to the left, and the table's first column (the code) reads
  from the right. Everything mirrors; nothing is centred.

---

## 5. Components

| Component | Shape |
|---|---|
| Primary button | Filled, primary colour, fully rounded (pill), icon + label. |
| Secondary button | Outlined, thin border, transparent fill, pill shape. |
| Destructive action | Text or outlined, red; never a filled red button for a routine step. |
| Input | Outlined, dense, rectangle with a small radius; the label sits inside until typed. |
| Card / panel | Rectangle, hairline border, 12 px radius, no shadow. |
| Dialog / form sheet | A sliding panel from the side (or a centred dialog), the fields in a single column, the confirm button at the bottom. |
| Status chip | Small pill: Draft (grey), Posted (green), Cancelled/Reversed (red), Open year (green) / Closed year (grey). |
| Empty state | A short line of what is missing plus the action that fixes it. No illustration. |
| Toast | One line at the bottom, the same wording as the error the server sent. |

---

## 6. Numbers and money

- Money: two decimals, thousands separated, no currency symbol inside the
  table (the currency is a column header). Example: `12,480.00`.
- Quantities: up to three decimals where the unit needs it, otherwise whole.
- Dates: `2026-10-08` in tables; "08 Oct 2026" only in a heading.
- A total row ends a table, in a slightly tinted strip, with the word "Total".
- A report that does not balance says so out loud: a small red line
  "Difference: 24.00" next to the totals.

---

## 7. Printing

Every list and every report has a printable page: **A4 portrait**, white, no
navigation, no buttons. A title, the company name under it, a meta line with
the row count and the export time, the table with hairline borders, and a
"Generated …" caption at the bottom. This page is generated as HTML on the
server, so a design for it can be handed over as HTML and CSS directly.

---

## 8. What not to do

- No illustrations, mascots, 3D shapes, glassmorphism, neon or dark patterns.
- No hero sections, marketing copy or feature cards inside the program.
- No more than two levels of nesting on a screen.
- Never hide a number behind hover, a tooltip, or a click.
- Never put the only copy of an action in a toolbar icon with no label; people
  in an accounts office need the words.
