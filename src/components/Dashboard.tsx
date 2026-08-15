import { useEffect, useMemo, useState } from 'react';
import type { Overview } from '../lib/aggregate';
import { summarizeByDay, summarizeByMonth, summarizeByWeek } from '../lib/aggregate';
import { adjacentPeriod, cycleBounds, currentCyclePeriod } from '../lib/budget';
import type { Transaction } from '../types';
import { dayLabel } from '../lib/format';
import KpiCards from './KpiCards';
import MonthlyCashflowChart, { type Granularity } from './MonthlyCashflowChart';
import CategoryBreakdown from './CategoryBreakdown';

interface Props {
  overview: Overview;
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  monthStartDay: number;
  weekStartDay: number;
  pendingCount: number;
  onReview?: () => void;
  hiddenCount?: number;
  onManageHidden?: () => void;
  onDrillToTransactions?: (from: string, to: string) => void;
  /** True while "Combine all cards" is selected — these props then describe
   *  the combined data instead of a single card's. */
  combineEnabled?: boolean;
  combinedCardNames?: string[];
  mixedCurrency?: boolean;
}

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'week', label: 'Weekly' },
  { key: 'day', label: 'Daily' },
];

// Above this many bars the chart gets hard to read — just a nudge, not a limit.
const DENSE_POINT_WARNING = 120;

type PresetKey = 'mtd' | 'lastMonth' | 'last3';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'mtd', label: 'Month to date' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last3', label: 'Last 3 months' },
];

/** A preset's [from, to] span, in terms of the user's own pay-cycle start
 *  day rather than calendar months — "last month" is the cycle right before
 *  the one containing today, not the 1st-to-last-day calendar month. */
function presetRange(
  key: PresetKey,
  monthStartDay: number,
  bounds: { min: string; max: string },
): { from: string; to: string } {
  const current = currentCyclePeriod(monthStartDay);
  const clamp = (d: string) => (d < bounds.min ? bounds.min : d > bounds.max ? bounds.max : d);

  if (key === 'lastMonth') {
    const { from, to } = cycleBounds(adjacentPeriod(current, -1), monthStartDay);
    return { from: clamp(from), to: clamp(to) };
  }
  // 'mtd' starts at the current cycle; 'last3' starts two cycles earlier, so
  // it spans this partial cycle plus the two full ones before it. Both run
  // through the latest data available, not all the way to today, so a card
  // whose last import is old doesn't show a mostly-empty trailing gap.
  const startPeriod = key === 'last3' ? adjacentPeriod(current, -2) : current;
  const { from } = cycleBounds(startPeriod, monthStartDay);
  return { from: clamp(from), to: bounds.max };
}

function ordinal(d: number): string {
  if (d % 10 === 1 && d !== 11) return `${d}st`;
  if (d % 10 === 2 && d !== 12) return `${d}nd`;
  if (d % 10 === 3 && d !== 13) return `${d}rd`;
  return `${d}th`;
}

function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** The inclusive [from, to] calendar span a clicked bucket key represents,
 *  given the active granularity (and pay-cycle start day for months). */
function periodBounds(key: string, granularity: Granularity, monthStartDay: number): { from: string; to: string } {
  if (granularity === 'day') return { from: key, to: key };
  if (granularity === 'week') return { from: key, to: addDaysISO(key, 6) };

  const [y, m] = key.split('-').map(Number);
  const startDay = Math.max(1, monthStartDay);
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = `${y}-${pad(m)}-${pad(startDay)}`;
  const nextIdx = y * 12 + (m - 1) + 1;
  const ny = Math.floor(nextIdx / 12);
  const nm = (nextIdx % 12) + 1;
  const nextStart = `${ny}-${pad(nm)}-${pad(startDay)}`;
  return { from, to: addDaysISO(nextStart, -1) };
}

export default function Dashboard({
  overview,
  transactions,
  categoryOf,
  monthStartDay,
  weekStartDay,
  pendingCount,
  onReview,
  hiddenCount = 0,
  onManageHidden,
  onDrillToTransactions,
  combineEnabled = false,
  combinedCardNames = [],
  mixedCurrency = false,
}: Props) {
  const [granularity, setGranularity] = useState<Granularity>('day');

  // The exact first/last transaction dates — the date pickers below let the
  // user pick any day in between, not just whole months.
  const dateBounds = useMemo(() => {
    if (transactions.length === 0) return { min: '', max: '' };
    let min = transactions[0].date;
    let max = transactions[0].date;
    for (const t of transactions) {
      if (t.date < min) min = t.date;
      if (t.date > max) max = t.date;
    }
    return { min, max };
  }, [transactions]);

  const [from, setFrom] = useState(dateBounds.min);
  const [to, setTo] = useState(dateBounds.max);

  // Reset the window to the full range whenever the available span changes.
  useEffect(() => {
    setFrom(dateBounds.min);
    setTo(dateBounds.max);
  }, [dateBounds.min, dateBounds.max]);

  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;

  // Filter the raw transactions to the exact selected days first, then bucket
  // — this keeps day/week/month views all honoring the same precise range,
  // instead of only being able to clip at month boundaries.
  const rangedTransactions = useMemo(
    () => transactions.filter((t) => t.date >= lo && t.date <= hi),
    [transactions, lo, hi],
  );

  const monthBuckets = useMemo(
    () => summarizeByMonth(rangedTransactions, monthStartDay, categoryOf),
    [rangedTransactions, monthStartDay, categoryOf],
  );

  const chartMonths = useMemo(() => {
    if (granularity === 'month') return monthBuckets;
    return granularity === 'day'
      ? summarizeByDay(rangedTransactions, categoryOf)
      : summarizeByWeek(rangedTransactions, weekStartDay, categoryOf);
  }, [granularity, monthBuckets, rangedTransactions, weekStartDay, categoryOf]);

  const applyPreset = (key: PresetKey) => {
    if (!dateBounds.max) return; // nothing to range over — see the empty-state below
    const { from, to } = presetRange(key, monthStartDay, dateBounds);
    setFrom(from);
    setTo(to);
  };

  const activePreset = (key: PresetKey): boolean => {
    if (!dateBounds.max) return false;
    const { from, to } = presetRange(key, monthStartDay, dateBounds);
    return lo === from && hi === to;
  };

  const rangedNote =
    lo === dateBounds.min && hi === dateBounds.max ? 'All time' : `${dayLabel(lo)} – ${dayLabel(hi)}`;
  const cycleNote =
    monthStartDay > 1
      ? `Months run from the ${ordinal(monthStartDay)} to the ${ordinal(monthStartDay - 1)}.`
      : null;

  // Every transaction is currently in a hidden category/sub-category —
  // nothing left to chart or total.
  if (transactions.length === 0) {
    return (
      <div className="dashboard">
        <section className="panel">
          <p className="muted">
            Every transaction {combineEnabled ? 'across your combined cards' : 'on this card'} is
            currently hidden by {combineEnabled ? "this combined view's" : 'your'} category filter, so
            there’s nothing to show here.{' '}
            {onManageHidden && (
              <button type="button" className="linklike" onClick={onManageHidden}>
                Manage hidden categories
              </button>
            )}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <section className="panel controls">
        <div className="controls-row">
          <div className="seg seg-sm">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={activePreset(p.key) ? 'seg-on' : ''}
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="range-pickers">
            <label className="picker">
              <span className="picker-label">From</span>
              <input
                type="date"
                value={lo}
                min={dateBounds.min}
                max={dateBounds.max}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <span className="range-dash">→</span>
            <label className="picker">
              <span className="picker-label">To</span>
              <input
                type="date"
                value={hi}
                min={dateBounds.min}
                max={dateBounds.max}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
        </div>
        {cycleNote && <p className="muted controls-note">{cycleNote}</p>}
        {combineEnabled && (
          <p className="muted controls-note">
            Combining {combinedCardNames.join(', ')} into these charts.
            {mixedCurrency && ' These cards use different currencies, so totals mix units.'}
          </p>
        )}
      </section>

      <div className="section-label">
        <span>Overview</span>
      </div>
      {hiddenCount > 0 && (
        <p className="muted hidden-note">
          Excluding {hiddenCount} hidden categor{hiddenCount === 1 ? 'y' : 'ies'}/sub-categories from
          all totals.
          {onManageHidden && (
            <button type="button" className="linklike" onClick={onManageHidden}>
              manage in Categories
            </button>
          )}
        </p>
      )}
      <KpiCards overview={overview} />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>
              {granularity === 'day' ? 'Daily' : granularity === 'week' ? 'Weekly' : 'Monthly'}{' '}
              cashflow
            </h2>
            <p className="muted">
              Money in, money out, and the net each {granularity} · {rangedNote}
            </p>
          </div>
          <div className="seg seg-sm">
            {GRANULARITIES.map((g) => (
              <button
                key={g.key}
                type="button"
                className={granularity === g.key ? 'seg-on' : ''}
                onClick={() => setGranularity(g.key)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        {chartMonths.length > DENSE_POINT_WARNING && (
          <p className="muted chart-dense-note">
            {chartMonths.length} bars shown. Narrow the date range for a clearer view.
          </p>
        )}
        <MonthlyCashflowChart
          months={chartMonths}
          granularity={granularity}
          onPeriodClick={
            onDrillToTransactions &&
            ((key) => {
              const { from, to } = periodBounds(key, granularity, monthStartDay);
              onDrillToTransactions(from, to);
            })
          }
        />
        {onDrillToTransactions && (
          <p className="muted chart-hint">
            Click a point on the chart to see that {granularity}’s transactions.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Where your money goes</h2>
            <p className="muted">Spending by category · {rangedNote}</p>
          </div>
          <div className="panel-actions">
            {onReview && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onReview}>
                Review categories
                {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
              </button>
            )}
          </div>
        </div>
        <CategoryBreakdown months={monthBuckets} />
      </section>
    </div>
  );
}
