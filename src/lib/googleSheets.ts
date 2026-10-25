import Papa from 'papaparse';
import type { ParsedFile } from '../types';
import { GOOGLE_CLIENT_ID } from './cloudSync/config';
import { loadGis } from './cloudSync/googleDrive';
import { parseAmount, parseDate } from './parse';

export interface SheetLocation { id: string; gid: number }
export interface SmsSheet { rows: Record<string, string>[]; location: SheetLocation; fileName?: string }

export function isSmsSheetHeaders(headers: string[]): boolean {
  return ['Direction', 'Amount', 'Currency', 'Transaction Date', 'Merchant / Counterparty', 'Account / Card'].every((h) => headers.includes(h));
}

export function parseSheetUrl(value: string): SheetLocation {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid Google Sheets URL.'); }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match || url.username || url.password || url.port) {
    throw new Error('Use an https://docs.google.com/spreadsheets/d/… URL.');
  }
  const gid = new URLSearchParams(url.hash.slice(1)).get('gid') ?? url.searchParams.get('gid') ?? '0';
  if (!/^\d+$/.test(gid) || !Number.isSafeInteger(Number(gid))) throw new Error('Invalid sheet tab ID.');
  return { id: match[1], gid: Number(gid) };
}

export function smsSheetFromMatrix(matrix: unknown[][], location: SheetLocation): SmsSheet {
  const headers = (matrix[0] ?? []).map((v) => String(v ?? '').trim());
  const required = ['Direction', 'Amount', 'Currency', 'Transaction Date', 'Merchant / Counterparty', 'Account / Card'];
  if (required.some((h) => !headers.includes(h))) {
    throw new Error(`This tab must contain these SMS automation columns: ${required.join(', ')}.`);
  }
  const rows = matrix.slice(1).filter((row) => row.some((v) => String(v ?? '').trim())).map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '').trim()])),
  );
  if (!rows.length) throw new Error('No transactions found in this sheet tab.');
  return { location, rows };
}

// A separate, read-only grant: Drive backup's drive.file scope cannot read
// arbitrary existing spreadsheets. Tokens stay in memory and never in storage.
export async function authorizeSheets(): Promise<string> {
  if (!GOOGLE_CLIENT_ID) throw new Error('Google sign-in needs VITE_GOOGLE_CLIENT_ID configured for this app.');
  await loadGis();
  return new Promise((resolve, reject) => {
    window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      callback: (response) => response.access_token && !response.error
        ? resolve(response.access_token)
        : reject(new Error(response.error || 'Google did not grant spreadsheet access.')),
      error_callback: () => reject(new Error('Google sign-in was cancelled or blocked. Please try again.')),
    }).requestAccessToken();
  });
}

export async function fetchSmsSheet(url: string, token?: string, signal?: AbortSignal): Promise<SmsSheet> {
  const location = parseSheetUrl(url);
  const options: RequestInit = { signal, credentials: 'omit', cache: 'no-store' };
  if (token) {
    options.headers = { Authorization: `Bearer ${token}` };
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${location.id}`;
    const metadata = await fetch(`${base}?fields=sheets.properties`, options);
    if (!metadata.ok) throw new Error(`Cannot read the spreadsheet (${metadata.status}). Sign in with an account that has access.`);
    const data = await metadata.json() as { sheets?: { properties: { sheetId: number; title: string } }[] };
    const tab = data.sheets?.find((s) => s.properties.sheetId === location.gid);
    if (!tab) throw new Error('The selected sheet tab was not found. Check the URL’s gid.');
    const range = `'${tab.properties.title.replace(/'/g, "''")}'`;
    const response = await fetch(`${base}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`, options);
    if (!response.ok) throw new Error(`Cannot read sheet rows (${response.status}). Try signing in again.`);
    const values = await response.json() as { values?: unknown[][] };
    return smsSheetFromMatrix(values.values ?? [], location);
  }
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${location.id}/export?format=csv&gid=${location.gid}`, options);
  if (!response.ok) throw new Error('This sheet needs Google sign-in, or its link does not allow reading.');
  const text = await response.text();
  if (/^\s*<!doctype|^\s*<html/i.test(text)) throw new Error('Google returned a sign-in page. Use Google sign-in for a private sheet.');
  const csv = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  if (csv.errors.length) throw new Error('Google returned invalid CSV. Check the sheet link and try again.');
  return smsSheetFromMatrix(csv.data, location);
}

/** The automation uses US-style dates, including ambiguous dates like 10/02. */
function smsDate(raw: string): string {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : raw;
  const parsed = parseDate(iso);
  if (!parsed || new Date(`${parsed}T00:00:00Z`).toISOString().slice(0, 10) !== parsed) return '';
  return parsed;
}

export function prepareSmsImport(sheet: SmsSheet, account: string, currency: string): ParsedFile {
  if (!account || !currency) throw new Error('Choose one account and currency before importing.');
  const rows = sheet.rows.filter((r) => r['Account / Card'] === account && r.Currency.toUpperCase() === currency.toUpperCase()).map((row) => {
    const amount = parseAmount(row.Amount);
    const direction = row.Direction.toUpperCase();
    const signed = Number.isFinite(amount) && ['IN', 'OUT'].includes(direction)
      ? Math.abs(amount) * (direction === 'OUT' ? -1 : 1) : NaN;
    const description = row['Merchant / Counterparty'] || row['Transaction Type'] || row['Raw SMS'] || '';
    // Raw SMS is a stable fallback for rows without a bank reference. Receipt
    // timestamps and sheet positions are deliberately excluded from identity.
    const identity = row['Transaction ID']
      ? ['reference', account, row['Transaction ID']]
      : ['sms', account, currency.toUpperCase(), row['Transaction Date'], row['Transaction Time'] || '', signed, row['Raw SMS'] || description];
    return {
      Date: smsDate(row['Transaction Date']),
      Description: description,
      Amount: Number.isFinite(signed) ? String(signed) : '',
      __sheetIdentity: `sheet:${JSON.stringify(identity)}`,
    };
  });
  return {
    fileName: `${sheet.fileName ?? `Google Sheets · ${sheet.location.id} · tab ${sheet.location.gid}`} · ${account} · ${currency.toUpperCase()}`,
    importKind: 'google-sheet',
    headers: ['Date', 'Description', 'Amount'],
    rows,
    suggestedMapping: { dateColumn: 'Date', descriptionColumn: 'Description', amountColumn: 'Amount', positiveMeans: 'income' },
  };
}
