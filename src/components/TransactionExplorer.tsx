import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { periodKey } from '../lib/aggregate';
import { categoryColor } from '../lib/categorize';
import { money, monthLabel } from '../lib/format';

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  /** Shared date range (YYYY-MM) from the dashboard controls. */
  lo: string;
  hi: string;
  monthStartDay: number;
}

const MAX_ROWS = 200;

/**
 * Slice spending by category + the selected time range (+ optional keyword) and
 * see both the aggregate stats and the underlying transactions.
 */
export default function TransactionExplorer({ transactions, categoryOf, lo, hi, monthStartDay }: Props) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'date' | 'amount'>('date');

  // Expenses within the selected period, tagged with their resolved category.
  const inRange = useMemo(
    () =>
      transactions
        .filter((t) => t.amount < 0)
        .map((t) => ({ t, cat: categoryOf(t), period: periodKey(t.date, monthStartDay) }))
        .filter((x) => x.period >= lo && x.period <= hi),
    [transactions, categoryOf, lo, hi, monthStartDay],
  );

  const catOrder = useMemo(() => {
    const totals = new Map<string, number>();
    for (const x of inRange) totals.set(x.cat, (totals.get(x.cat) ?? 0) + -x.t.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [inRange]);

  const active = selected ?? new Set(catOrder);
  const needle = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    const rows = inRange.filter(
      (x) => active.has(x.cat) && (!needle || x.t.description.toLowerCase().includes(needle)),
    );
    rows.sort((a, b) =>
      sort === 'date'
        ? b.t.date.localeCompare(a.t.date)
        : Math.abs(b.t.amount) - Math.abs(a.t.amount),
    );
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRange, selected, needle, sort]);

  const stats = useMemo(() => {
    const total = filtered.reduce((a, x) => a + -x.t.amount, 0);
    const rangeTotal = inRange.reduce((a, x) => a + -x.t.amount, 0);
    const periods = new Set(filtered.map((x) => x.period));
    const largest = filtered.reduce((m, x) => Math.max(m, -x.t.amount), 0);
    return {
      total,
      count: filtered.length,
      perMonth: periods.size ? total / periods.size : 0,
      share: rangeTotal > 0 ? (total / rangeTotal) * 100 : 0,
      largest,
    };
  }, [filtered, inRange]);

  const toggle = (c: string) => {
    const next = new Set(active);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setSelected(next);
  };

  if (inRange.length === 0) {
    return <p className="muted">No expenses in the selected date range.</p>;
  }

  return (
    <div>
      <div className="explorer-controls">
        <input
          className="explorer-search"
          value={search}
          placeholder="Filter by description…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="trends-quick">
          <span className="muted">Sort</span>
          <button
            type="button"
            className={sort === 'date' ? 'linklike on' : 'linklike'}
            onClick={() => setSort('date')}
          >
            Newest
          </button>
          <button
            type="button"
            className={sort === 'amount' ? 'linklike on' : 'linklike'}
            onClick={() => setSort('amount')}
          >
            Largest
          </button>
        </div>
      </div>

      <div className="cat-chips">
        <button type="button" className="linklike" onClick={() => setSelected(new Set(catOrder))}>
          All
        </button>
        <button type="button" className="linklike" onClick={() => setSelected(new Set())}>
          None
        </button>
        {catOrder.map((c) => (
          <button
            key={c}
            type="button"
            className={`cat-chip ${active.has(c) ? 'on' : ''}`}
            onClick={() => toggle(c)}
          >
            <span className="catdot" style={{ background: categoryColor(c) }} />
            {c}
          </button>
        ))}
      </div>

      <div className="explorer-stats">
        <Stat label="Total" value={money(stats.total)} />
        <Stat label="Transactions" value={String(stats.count)} />
        <Stat label="Avg / month" value={money(stats.perMonth)} />
        <Stat label="Share of range" value={`${stats.share.toFixed(0)}%`} />
        <Stat label="Largest" value={money(stats.largest)} />
      </div>

      <div className="table-wrap explorer-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, MAX_ROWS).map(({ t, cat }) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td className="desc" title={t.description}>
                  {t.description || '—'}
                </td>
                <td>
                  <span className="catdot" style={{ background: categoryColor(cat) }} /> {cat}
                </td>
                <td className="num neg">{money(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > MAX_ROWS && (
          <div className="muted refine-more">
            Showing the first {MAX_ROWS} of {filtered.length}. Narrow the filters to see more.
          </div>
        )}
        {filtered.length === 0 && <div className="muted refine-more">No transactions match these filters.</div>}
      </div>

      <p className="muted explorer-foot">
        {monthLabel(lo)} – {monthLabel(hi)} · change the range with the From/To pickers at the top.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="explorer-stat">
      <div className="explorer-stat-label">{label}</div>
      <div className="explorer-stat-value">{value}</div>
    </div>
  );
}
