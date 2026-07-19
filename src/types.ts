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
  createdAt: number;
}

/** A manual, per-transaction category assignment (highest precedence). */
export interface CategoryOverride {
  id: string; // transaction id
  category: string;
}

/**
 * A refinement rule: any transaction whose description contains `keyword` gets
 * `category`. Keyword rules outrank the wizard's signature rules, and a newer
 * keyword rule wins over an older one, so later refinements take priority.
 */
export interface KeywordRule {
  keyword: string; // lowercased substring to match
  category: string;
  createdAt: number;
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
  createdAt: number;
}

/** A manual per-transaction sub-category assignment (highest sub precedence). */
export interface SubOverride {
  id: string; // transaction id
  parent: string; // the category it was tagged under
  sub: string;
}
