# CashFlow

A private, browser-only web app for understanding your **monthly cashflow** from bank
statements. Each month you upload your **latest** statement — CashFlow remembers everything
you've imported before and keeps building your history (10 years and beyond). It focuses on the
high-level picture: how much came in, how much went out, and the **net each month**, plus the
trends over time.

Your statements never leave your device. All parsing and storage happen in your browser
(IndexedDB) — there is no server and no account.

## Highlights

- **Upload once a month.** Drop in a CSV or Excel export; history accumulates automatically.
- **Smart column detection.** Auto-detects the date, amount, and description columns and shows a
  live preview before importing. Supports a single signed `Amount` column or separate
  money-in / money-out (debit/credit) columns.
- **Safe re-uploads.** Transactions are de-duplicated by a hash of date + amount + description, so
  re-importing an overlapping statement never double-counts.
- **Guided categorization.** Instead of pure keyword guessing, a wizard groups
  similar transactions by merchant (fuzzy — descriptions need not match exactly),
  lets you exclude outliers and assign one category per group, then quick-classify
  the leftovers. Decisions are saved as rules and **auto-apply to future imports**,
  so you're never re-prompted for merchants you've already classified.
- **High-level dashboard.**
  - Net cashflow per month (with a 3-month moving average)
  - Income vs. expenses per month
  - KPIs: net saved, average net/month, savings rate, best & toughest months, 6-month trend
  - Monthly breakdown table and a list of imported statements
- **Robust parsing.** Handles many date formats, currency symbols, thousands separators,
  parentheses-for-negative and CR/DR markers, Excel serial dates, and CSV files with preamble rows.

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # typecheck + production build into dist/
npm run preview  # preview the production build
```

Then open the local URL, and drop in a statement exported from your bank.

## Importing your SMS automation from Google Sheets

Open **Import from Google Sheets** on an individual card, paste the sheet URL
(including its `gid` tab), and choose **Read shared sheet** or **Sign in with
Google (private sheet)**. Select the matching **Account / Card**, then **Review
transactions** and import. The link is remembered locally for that card. Read
the sheet again whenever your automation adds transactions; imports are manual,
not background polling. The app only reads the sheet and never modifies it.

The supported automation columns are `Direction`, `Amount`, `Currency`,
`Transaction Date`, `Merchant / Counterparty`, and `Account / Card`. Optional
`Raw SMS`, `Transaction Time`, `Transaction Type`, and `Transaction ID` improve
descriptions and stable duplicate detection. `IN` is income and `OUT` is an
expense. Automation dates use **MM/DD/YYYY**, not the bank-file date convention.
Three-decimal OMR amounts are preserved.

Import each account into its own card. Only rows in the active card's currency
are imported: USD purchases are excluded from an OMR card, since the SMS does
not contain their settled OMR amount. Import those from your OMR bank statement
instead. Missing/invalid transaction dates and invalid amounts/directions are
skipped and counted in the preview; fix them in the sheet and import again.
`Received At` is never assumed to be the transaction date. **Available Balance /
Limit** is not imported as a balance, because it can be an available credit
limit rather than an account balance.

Repeated sheet imports use the bank's transaction reference when available,
otherwise a stable SMS identity including account, date, time and message.
Statement and sheet entries with matching normalized date, signed amount and
description merge automatically. When descriptions differ, **Review possible
duplicates** pairs sheet and statement entries with the same date and exact
amount, one-to-one. Checked pairs count once; uncheck separate payments. Verify
these suggestions, particularly when several payments share a date and amount.
Confirmed matches are remembered for future imports in this browser, including
after reload. A later statement can fill the stored transaction's balance
without replacing its notes or categorization. Import order does not matter.
Identical SMS notifications without a unique reference or time cannot be
distinguished reliably; make sure the automation records a unique reference or
transaction time when separate payments would otherwise be identical.

For private sheets, the app owner must enable the **Google Sheets API** in the
Google Cloud project, configure an OAuth **Web application** client with the
app's exact origin under **Authorized JavaScript origins**, configure the
consent screen/test users and the read-only scope
`https://www.googleapis.com/auth/spreadsheets.readonly`, then set the public
`VITE_GOOGLE_CLIENT_ID` at build/dev startup. Restart Vite or rebuild after
changing it. This uses the same client ID as Drive backups, but requests a
separate read-only Sheets grant; existing Drive backup access alone cannot read
your transaction sheet. No client secret is needed. Sign-in grants and tokens
are not saved; sign in again when refreshing a private sheet.

Keep private financial sheets private. If sign-in is not configured, download
the tab using **File → Download → Comma-separated values (.csv)** and upload it
through the existing statement dropzone. SMS-format CSV/Excel uploads use the
same account selection, currency filtering and overlap review as the link.
Shared-link reading works only when Google permits anonymous export and the
browser/network permits the request. Never paste OAuth tokens into the URL.

## How to export a statement from your bank

Most banks offer a "Download / Export transactions" option that produces a **CSV** (or Excel)
file. That's the most reliable format. Export the period you want (a single month each month, or a
longer range for backfilling history) and drop the file into CashFlow.

## Tech

- React + TypeScript + Vite
- [PapaParse](https://www.papaparse.com/) (CSV) and [SheetJS](https://sheetjs.com/) (Excel)
- [Recharts](https://recharts.org/) for charts
- [idb](https://github.com/jakearchibald/idb) over IndexedDB for local persistence

## Project layout

```
src/
  lib/
    parse.ts      # read CSV/Excel, detect columns, normalize transactions
    db.ts         # IndexedDB storage + de-duplicating import
    aggregate.ts  # per-month summaries, overview KPIs, trends
    format.ts     # currency / date / percent formatting
  components/     # UI: upload, column mapper, dashboard, charts, tables
  App.tsx         # app state and orchestration
  types.ts        # shared domain types
```

## Privacy

There is no backend. Files are read in the browser, normalized, and stored in IndexedDB on your
machine. Use **Clear data** in the header to wipe everything.
