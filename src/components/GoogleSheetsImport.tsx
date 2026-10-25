import { useEffect, useRef, useState } from 'react';
import type { ParsedFile } from '../types';
import { authorizeSheets, fetchSmsSheet, parseSheetUrl, prepareSmsImport, type SmsSheet } from '../lib/googleSheets';
import { isGoogleConfigured } from '../lib/cloudSync/config';
import { scopedKey } from '../lib/cards';

interface Props {
  cardId: string;
  cardName: string;
  currency: string;
  disabled: boolean;
  uploadedSheet: SmsSheet | null;
  onInspect: (parsed: ParsedFile) => void;
}

export default function GoogleSheetsImport({ cardId, cardName, currency, disabled, uploadedSheet, onInspect }: Props) {
  const storageKey = scopedKey('cashflow.googleSheet', cardId);
  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem(storageKey) ?? ''; } catch { return ''; }
  });
  const [sheet, setSheet] = useState<SmsSheet | null>(null);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!uploadedSheet) return;
    controller.current?.abort();
    setBusy(false);
    setSheet(uploadedSheet);
    setError(null);
    const accounts = [...new Set(uploadedSheet.rows.map((r) => r['Account / Card']).filter(Boolean))];
    setAccount(accounts.length === 1 ? accounts[0] : '');
  }, [uploadedSheet]);

  const load = async (signIn: boolean) => {
    setError(null);
    try { parseSheetUrl(url); } catch (e) { setError((e as Error).message); return; }
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setBusy(true);
    setSheet(null);
    try {
      const token = signIn ? await authorizeSheets() : undefined;
      if (request.signal.aborted) return;
      const result = await fetchSmsSheet(url, token, request.signal);
      if (request.signal.aborted) return;
      const accounts = [...new Set(result.rows.map((r) => r['Account / Card']).filter(Boolean))];
      setAccount(accounts.length === 1 ? accounts[0] : '');
      setSheet(result);
      try { localStorage.setItem(storageKey, url.trim()); } catch { /* optional persistence */ }
    } catch (e) {
      if (!request.signal.aborted) setError(`${(e as Error).message} You can also download the sheet as CSV and upload it here.`);
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  const accounts = [...new Set(sheet?.rows.map((r) => r['Account / Card']).filter(Boolean) ?? [])];
  const selectedRows = sheet?.rows.filter((r) => r['Account / Card'] === account) ?? [];
  const foreignCount = selectedRows.filter((r) => r.Currency.toUpperCase() !== currency.toUpperCase()).length;
  const eligibleCount = selectedRows.length - foreignCount;

  return <section className="sheet-import" aria-label="Import Google Sheets transactions">
    <h3>Import from Google Sheets</h3>
    <p className="muted">Read your SMS automation’s latest transactions into <strong>{cardName}</strong>.
      Your sheet is read only; nothing is written back. Refresh here whenever new rows arrive.</p>
    <label className="field">
      <span>Google Sheets URL</span>
      <input type="url" value={url} placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
        disabled={busy || disabled} onChange={(e) => { setUrl(e.target.value); setSheet(null); setError(null); }} />
    </label>
    <div className="sheet-import-actions">
      <button className="btn btn-ghost" type="button" disabled={busy || disabled || !url.trim()} onClick={() => void load(false)}>
        {busy ? 'Reading…' : 'Read shared sheet'}
      </button>
      <button className="btn btn-ghost" type="button" disabled={busy || disabled || !url.trim() || !isGoogleConfigured()} onClick={() => void load(true)}>
        Sign in with Google (private sheet)
      </button>
    </div>
    {!isGoogleConfigured() && <p className="muted">Private sheets need Google sign-in configured by the app owner.
      You can keep the sheet private and download it as CSV instead.</p>}
    {error && <p role="alert" className="neg">{error}</p>}
    {sheet && <>
      {sheet.fileName && <p>Loaded {sheet.fileName}</p>}
      <label className="field"><span>Account / Card to import into {cardName}</span>
        <select value={account} disabled={disabled} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Choose an account…</option>
          {accounts.map((a) => <option value={a} key={a}>{a}</option>)}
        </select>
      </label>
      <p className="muted">{eligibleCount} rows in {currency} selected. {foreignCount} rows in other currencies excluded.
        Rows without a transaction date or valid IN/OUT amount are skipped. Available balances and credit limits are not imported.</p>
      <button type="button" className="btn btn-primary" disabled={disabled || !account || !eligibleCount}
        onClick={() => onInspect(prepareSmsImport(sheet, account, currency))}>Review transactions</button>
    </>}
  </section>;
}
