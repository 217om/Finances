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
