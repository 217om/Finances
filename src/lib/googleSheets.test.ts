import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSmsSheet, parseSheetUrl, prepareSmsImport, smsSheetFromMatrix } from './googleSheets';
import { normalize } from './parse';

const headers = ['Received At', 'Raw SMS', 'Direction', 'Amount', 'Currency', 'Transaction Date', 'Transaction Time', 'Transaction Type', 'Merchant / Counterparty', 'Account / Card', 'Available Balance / Limit', 'Balance Currency', 'Transaction ID'];
function sheet(rows: unknown[][]) {
  return smsSheetFromMatrix([headers, ...rows], { id: 'sample', gid: 17 });
}
function row(overrides: Record<string, string> = {}) {
  const data = { 'Received At': '10/24/2026 13:00:00', 'Raw SMS': 'An example payment notification', Direction: 'OUT', Amount: '7.245', Currency: 'OMR', 'Transaction Date': '10/02/2026', 'Transaction Time': '12:01:02', 'Transaction Type': 'Card purchase', 'Merchant / Counterparty': 'EXAMPLE CAFE', 'Account / Card': 'card-1111', 'Available Balance / Limit': '900.123', 'Balance Currency': 'OMR', 'Transaction ID': '', ...overrides };
  return headers.map((h) => data[h as keyof typeof data]);
}
function txs(rows: unknown[][]) {
  const parsed = prepareSmsImport(sheet(rows), 'card-1111', 'OMR');
  return normalize(parsed, parsed.suggestedMapping!);
}
afterEach(() => vi.unstubAllGlobals());

describe('Google Sheets URL and read access', () => {
  it('uses the selected tab, including a fragment overriding the query', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/example/edit?gid=1#gid=17')).toEqual({ id: 'example', gid: 17 });
  });
  it.each(['https://evil.test/spreadsheets/d/example', 'http://docs.google.com/spreadsheets/d/example', 'https://docs.google.com.evil.test/spreadsheets/d/example', 'https://docs.google.com/spreadsheets/d/example#gid=-1', 'https://user:password@docs.google.com/spreadsheets/d/example'])('rejects unsafe URLs: %s', (url) => {
    expect(() => parseSheetUrl(url)).toThrow();
  });
  it('reads CSV without sending browser cookies', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response([headers.join(','), row().join(',')].join('\n')));
    vi.stubGlobal('fetch', fetch);
    const result = await fetchSmsSheet('https://docs.google.com/spreadsheets/d/example/edit#gid=17');
    expect(result.rows).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('gid=17'), expect.objectContaining({ credentials: 'omit', cache: 'no-store' }));
  });
  it('uses authenticated API metadata to resolve gid rather than reading the first tab', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ sheets: [{ properties: { sheetId: 17, title: "SMS's tab" } }] }))
      .mockResolvedValueOnce(Response.json({ values: [headers, row()] }));
    vi.stubGlobal('fetch', fetch);
    await fetchSmsSheet('https://docs.google.com/spreadsheets/d/example/edit#gid=17', 'test-token');
    expect(fetch.mock.calls[1][0]).toContain(encodeURIComponent("'SMS''s tab'"));
    expect(fetch.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer test-token' });
  });
  it('explains access failures and rejects HTML login pages and wrong schemas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(fetchSmsSheet('https://docs.google.com/spreadsheets/d/example')).rejects.toThrow('sign-in');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><html>Login</html>')));
    await expect(fetchSmsSheet('https://docs.google.com/spreadsheets/d/example')).rejects.toThrow('sign-in');
    expect(() => smsSheetFromMatrix([['Date', 'Amount']], { id: 'example', gid: 0 })).toThrow('SMS automation');
  });
});

describe('SMS automation imports', () => {
  it('uses OUT as negative, IN as positive, US-style transaction dates, and preserves three decimals', () => {
    const { transactions } = txs([row(), row({ Direction: 'IN', Amount: '12.123', 'Transaction ID': 'credit-1' })]);
    expect(transactions.map((t) => t.amount)).toEqual([-7.245, 12.123]);
    expect(transactions[0]).toMatchObject({ date: '2026-10-02', description: 'EXAMPLE CAFE', importKind: 'google-sheet' });
    expect(transactions[0].balance).toBeUndefined();
  });
  it('filters account and currency instead of merging accounts or summing USD as OMR', () => {
    const result = txs([row(), row({ 'Account / Card': 'account-2222' }), row({ Currency: 'USD' })]);
    expect(result.transactions).toHaveLength(1);
  });
  it('skips missing or invalid transaction dates, unknown directions and invalid amounts', () => {
    const result = txs([row({ 'Transaction Date': '' }), row({ 'Transaction Date': '02/30/2026' }), row({ Direction: 'UNKNOWN' }), row({ Amount: 'invalid' })]);
    expect(result.transactions).toHaveLength(0);
    expect(result.skipped).toBe(4);
  });
  it('uses stable references across changed SMS text and sheet row order', () => {
    const a = txs([row({ 'Transaction ID': 'ref-123' })]).transactions[0];
    const b = txs([row({ 'Transaction ID': 'ref-123', 'Raw SMS': 'Reformatted notification', 'Received At': '10/25/2026' })]).transactions[0];
    expect(a.id).toBe(b.id);
  });
  it('distinguishes separate payments at the same merchant, date and amount', () => {
    const result = txs([row({ 'Transaction Time': '12:01:00' }), row({ 'Transaction Time': '13:01:00' })]);
    expect(result.transactions[0].id).not.toBe(result.transactions[1].id);
  });
  it('uses transaction type when a counterparty is absent', () => {
    expect(txs([row({ 'Merchant / Counterparty': '', 'Transaction Type': 'Account credit' })]).transactions[0].description).toBe('Account credit');
  });
});
