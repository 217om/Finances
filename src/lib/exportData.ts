// Backup / restore / CSV export. Everything runs in the browser; files are
// generated client-side and downloaded directly.

import type { Transaction } from '../types';
import { categorize } from './categorize';

const BACKUP_MAGIC = 'cashflow-backup';
const BACKUP_VERSION = 1;

interface BackupFile {
  app: typeof BACKUP_MAGIC;
  version: number;
  exportedAt: string;
  transactions: Transaction[];
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function triggerDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download a full-fidelity JSON backup that can be restored later. */
export function downloadBackup(txs: Transaction[]): void {
  const payload: BackupFile = {
    app: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: txs,
  };
  triggerDownload(JSON.stringify(payload, null, 2), `cashflow-backup-${stamp()}.json`, 'application/json');
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download the full history as a clean, spreadsheet-friendly CSV. */
export function downloadCSV(txs: Transaction[]): void {
  const header = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Source'];
  const lines = [header.join(',')];
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(
      [
        csvCell(t.date),
        csvCell(t.description),
        csvCell(t.amount.toFixed(2)),
        csvCell(t.amount >= 0 ? 'Income' : 'Expense'),
        csvCell(categorize(t.description, t.amount)),
        csvCell(t.source),
      ].join(','),
    );
  }
  triggerDownload(lines.join('\n'), `cashflow-transactions-${stamp()}.csv`, 'text/csv');
}

/** True if a filename looks like a JSON backup. */
export function isBackupFile(name: string): boolean {
  return /\.json$/i.test(name);
}

/**
 * Parse a CashFlow JSON backup back into transactions, or throw if the file
 * isn't a valid backup. Tolerant of minor shape differences.
 */
export function parseBackup(text: string): Transaction[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const obj = data as Partial<BackupFile>;
  if (obj.app !== BACKUP_MAGIC || !Array.isArray(obj.transactions)) {
    throw new Error('That JSON is not a CashFlow backup.');
  }
  const txs = obj.transactions.filter(
    (t): t is Transaction =>
      !!t &&
      typeof t.id === 'string' &&
      typeof t.date === 'string' &&
      typeof t.amount === 'number' &&
      typeof t.month === 'string',
  );
  if (txs.length === 0) throw new Error('The backup contained no transactions.');
  return txs;
}
