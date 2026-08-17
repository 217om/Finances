// Core domain types for CashFlow.

/** A single normalized bank transaction. */
export interface Transaction {
  /** Stable hash id derived from date + amount + description; used for de-duplication. */
  id: string;
  /** ISO date string, YYYY-MM-DD. */
  date: string;
  /** Signed amount. Positive = money in (income), negative = money out (expense). */
  amount: number;
  /** Cleaned-up description / payee text. */
  description: string;
  /** Month bucket, YYYY-MM. Stored for fast indexed grouping. */
  month: string;
  /** Name of the file this transaction was imported from. */
  source: string;
  /** Epoch millis of when this row was imported. */
  importedAt: number;
  /** Optional free-text note the user attached to this one transaction. Empty
   *  by default; absent entirely rather than an empty string when unset. */
  note?: string;
  /** Raw running balance from the statement's own Balance column, if it had
   *  one, exactly as parsed with no sign adjustment. Absent when the
   *  statement didn't include one. See lib/balances.ts for how this and any
   *  manual checkpoints combine into a card's current balance. */
  balance?: number;
  /** Position within its import batch (direction-corrected: higher always
   *  means chronologically later within that batch), combined with
   *  importedAt to break same-date ties correctly — storage order isn't
   *  chronological, so without this, picking "the last transaction of a
   *  day" (e.g. for a running-balance anchor) is arbitrary. Optional only
   *  for transactions imported before this field existed. */
  seq?: number;
}

/** How a raw spreadsheet maps onto our normalized fields. */
export interface ColumnMapping {
  dateColumn: string;
  descriptionColumn: string;
  /** Mode A: one signed amount column. */
  amountColumn?: string;
  /** Mode B: separate money-in / money-out columns. */
  debitColumn?: string;
  creditColumn?: string;
  /**
   * For a single amount column: does a positive number mean money IN or money OUT?
   * Most exports use positive = in, but some use positive = out.
   */
  positiveMeans: 'income' | 'expense';
  /** Optional running-balance column, if the statement includes one. */
  balanceColumn?: string;
}

/** Result of inspecting an uploaded file before committing it to storage. */
export interface ParsedFile {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  /** Best-guess mapping; the user can confirm or override it. */
  suggestedMapping: ColumnMapping | null;
}

/** Aggregated figures for a single calendar month. */
export interface MonthlySummary {
  month: string; // YYYY-MM
  income: number;
  expenses: number; // stored as a positive number
  net: number; // income - expenses
  txCount: number;
  /** Expense totals broken down by category (positive numbers). */
  categories: Record<string, number>;
}

/** Outcome of importing a file into the store. */
export interface ImportResult {
  added: number;
  duplicates: number;
  fileName: string;
}

/**
 * A user-defined categorization rule, keyed by a merchant "signature" derived
 * from the description. Applies to every current and future transaction whose
 * signature matches, except the explicitly excluded ones.
 */
export interface CategoryRule {
  signature: string;
  category: string;
  excludedIds: string[];
  sample: string;
  /** Doubles as the rule's priority (drag-to-reorder rewrites it) — NOT a
   *  reliable "last edited" signal, see updatedAt below. */
  createdAt: number;
  /** When this rule's category was last changed. Separate from createdAt
   *  specifically so sync-restore can tell which of two conflicting copies
   *  (e.g. from two devices) is actually more recent, without disturbing
   *  createdAt's priority-ordering role. Optional only for records written
   *  before this field existed — missing means "unknown, treat as oldest." */
  updatedAt?: number;
}

/** A manual, per-transaction category assignment (highest precedence). */
export interface CategoryOverride {
  id: string; // transaction id
  category: string;
  /** See CategoryRule.updatedAt — same purpose. */
  updatedAt?: number;
}

/**
 * A refinement rule: any transaction whose description contains `keyword` gets
 * `category`. Keyword rules outrank the wizard's signature rules, and a newer
 * keyword rule wins over an older one, so later refinements take priority.
 */
export interface KeywordRule {
  keyword: string; // lowercased substring to match
  category: string;
  /** Doubles as priority (newer wins at resolution time; drag-to-reorder
   *  rewrites it) — not a reliable "last edited" signal, see updatedAt. */
  createdAt: number;
  /** See CategoryRule.updatedAt — same purpose, kept separate from
   *  createdAt's priority role. */
  updatedAt?: number;
}

/**
 * An optional second tier under a category. A sub-rule tags any transaction
 * that already resolves to `parent` and whose description contains `keyword`
 * with the sub-category `sub`. Sub-categories never change the top-level
 * category — they only split a bucket (e.g. Transfers) into finer parts.
 */
export interface SubRule {
  id: string; // `${parent}${keyword}`
  parent: string; // top-level category this applies within
  keyword: string; // lowercased substring
  sub: string; // sub-category name
  /** Doubles as priority (drag-to-reorder rewrites it) — not a reliable
   *  "last edited" signal, see updatedAt. */
  createdAt: number;
  /** See CategoryRule.updatedAt — same purpose, kept separate from
   *  createdAt's priority role. */
  updatedAt?: number;
}

/** A manual per-transaction sub-category assignment (highest sub precedence). */
export interface SubOverride {
  id: string; // transaction id
  parent: string; // the category it was tagged under
  sub: string;
  /** See CategoryRule.updatedAt — same purpose. */
  updatedAt?: number;
}
