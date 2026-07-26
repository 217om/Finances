import { useEffect, useMemo, useState } from 'react';
import type { Overview } from '../lib/aggregate';
import { summarizeByDay, summarizeByWeek } from '../lib/aggregate';
import type { Transaction } from '../types';
import { monthLabel } from '../lib/format';
import KpiCards from './KpiCards';
import MonthlyCashflowChart, { type Granularity } from './MonthlyCashflowChart';
import CategoryBreakdown from './CategoryBreakdown';
import Insights from './Insights';

interface Props {
  overview: Overview;
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  monthStartDay: number;
  pendingCount: number;
  onReview?: () => void;
  onReset?: () => void;
  onRefine?: () => void;
  hiddenCount?: number;
  onManageHidden?: () => void;
  combineAvailable?: boolean;
  combineEnabled?: boolean;
  onToggleCombine?: () => void;
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

const PRESETS: { count: number | 'all'; label: string }[] = [
  { count: 12, label: '1Y' },
  { count: 24, label: '2Y' },
  { count: 60, label: '5Y' },
  { count: 'all', label: 'All' },
];

function ordinal(d: number): string {
  if (d % 10 === 1 && d !== 11) return `${d}st`;
  if (d % 10 === 2 && d !== 12) return `${d}nd`;
  if (d % 10 === 3 && d !== 13) return `${d}rd`;
  return `${d}th`;
}

export default function Dashboard({
  overview,
  transactions,
  categoryOf,
  monthStartDay,
  pendingCount,
  onReview,
  onReset,
  onRefine,
  hiddenCount = 0,
  onManageHidden,
  combineAvailable = false,
  combineEnabled = false,
  onToggleCombine,
  combinedCardNames = [],
  mixedCurrency = false,
}: Props) {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const keys = useMemo(() => overview.months.map((m) => m.month), [overview.months]);
  const first = keys[0];
  const last = keys[keys.length - 1];

  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);

  // Reset the window to the full range whenever the available span changes.
  useEffect(() => {
    setFrom(first);
    setTo(last);
  }, [first, last]);

  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;

  const visible = useMemo(
    () => overview.months.filter((m) => m.month >= lo && m.month <= hi),
    [overview.months, lo, hi],
  );

  // Daily/weekly views are computed straight from transactions (not the
  // monthly `overview`) and then clipped to the selected month range — the
  // range's own From/To pickers stay month-grained regardless of chart mode.
  const chartMonths = useMemo(() => {
    if (granularity === 'month') return visible;
    const buckets =
      granularity === 'day' ? summarizeByDay(transactions, categoryOf) : summarizeByWeek(transactions, categoryOf);
    return buckets.filter((b) => {
      const monthPrefix = b.month.slice(0, 7);
      return monthPrefix >= lo && monthPrefix <= hi;
    });
  }, [granularity, visible, transactions, categoryOf, lo, hi]);

  const applyPreset = (count: number | 'all') => {
    if (count === 'all' || keys.length <= count) setFrom(keys[0]);
    else setFrom(keys[keys.length - count]);
    setTo(keys[keys.length - 1]);
  };

  const activePreset = (count: number | 'all'): boolean => {
    if (hi !== last) return false;
    if (count === 'all') return lo === first;
    return lo === keys[Math.max(0, keys.length - count)] && keys.length > count;
  };

  const rangedNote =
    lo === first && hi === last ? 'All time' : `${monthLabel(lo)} – ${monthLabel(hi)}`;
  const cycleNote =
    monthStartDay > 1
      ? `Months run from the ${ordinal(monthStartDay)} to the ${ordinal(monthStartDay - 1)}.`
      : null;

  return (
    <div className="dashboard">
      <section className="panel controls">
        <div className="controls-row">
          <div className="seg seg-sm">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={activePreset(p.count) ? 'seg-on' : ''}
                onClick={() => applyPreset(p.count)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="range-pickers">
            <label className="picker">
              <span className="picker-label">From</span>
              <select value={lo} onChange={(e) => setFrom(e.target.value)}>
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {monthLabel(k)}
                  </option>
                ))}
              </select>
            </label>
            <span className="range-dash">→</span>
            <label className="picker">
              <span className="picker-label">To</span>
              <select value={hi} onChange={(e) => setTo(e.target.value)}>
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {monthLabel(k)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {cycleNote && <p className="muted controls-note">{cycleNote}</p>}
        {combineAvailable && (
          <div className="combine-row">
            <label className="filter-check">
              <input type="checkbox" checked={combineEnabled} onChange={() => onToggleCombine?.()} />
              Combine all cards in these charts
            </label>
            {combineEnabled && (
              <span className="muted combine-note">
                Showing {combinedCardNames.join(', ')} together.
                {mixedCurrency && ' These cards use different currencies — totals mix units.'}
              </span>
            )}
          </div>
        )}
      </section>

      <div className="section-label">
        <span>Overview</span>
        <span className="muted">All time</span>
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
            {chartMonths.length} bars shown — narrow the date range above for a clearer view.
          </p>
        )}
        <MonthlyCashflowChart months={chartMonths} granularity={granularity} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Where your money goes</h2>
            <p className="muted">Spending by category · {rangedNote}</p>
          </div>
          <div className="panel-actions">
            {onRefine && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRefine}>
                Refine
              </button>
            )}
            {onReset && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
                Start over
              </button>
            )}
            {onReview && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onReview}>
                Review categories
                {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
              </button>
            )}
          </div>
        </div>
        <CategoryBreakdown months={visible} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Insights</h2>
            <p className="muted">Recurring items and alerts, from your full history.</p>
          </div>
        </div>
        <Insights overview={overview} />
      </section>
    </div>
  );
}
