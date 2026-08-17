import { useEffect, useMemo, useState } from 'react';
import { buildOverview, summarizeByDay, summarizeByMonth, summarizeByWeek } from '../lib/aggregate';
import { type PresetKey, PRESETS, presetRange, addDaysISO } from '../lib/rangePresets';
import type { Transaction } from '../types';
import { dayLabel } from '../lib/format';
import KpiCards from './KpiCards';
import MonthlyCashflowChart, { type Granularity } from './MonthlyCashflowChart';
import CategoryBreakdown from './CategoryBreakdown';
import CompareMenu, { type CompareOption } from './CompareMenu';

interface Props {
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

function ordinal(d: number): string {
  if (d % 10 === 1 && d !== 11) return `${d}st`;
  if (d % 10 === 2 && d !== 12) return `${d}nd`;
  if (d % 10 === 3 && d !== 13) return `${d}rd`;
  return `${d}th`;
}

/** Shifts a date by whole calendar months, clamping the day when the target
 *  month is shorter (May 31 minus 1 month is April 30, not "May 1" — which
 *  is what naive Date arithmetic would silently roll over to). */
function addCalendarMonths(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const targetIdx = m - 1 + delta;
  const ny = y + Math.floor(targetIdx / 12);
  const nm0 = ((targetIdx % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(ny, nm0 + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTarget);
  return `${ny}-${String(nm0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInclusive(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000) + 1;
}

/** One comparison target per preset, each shifting the *end* of the current
 *  range back by a calendar amount and then taking the same number of days
 *  the current range spans — so a still-partial period (week/month to date)
 *  compares against an equally partial one instead of a full prior period,
 *  and a complete one (last month, last 3 months) compares against an
 *  equally complete one. No well-defined comparison exists for a hand-typed
 *  custom range, so this returns none then. */
const COMPARE_SHIFTS: Record<PresetKey, { key: string; label: string; monthsBack?: number; daysBack?: number }[]> = {
  wtd: [
    { key: 'lastWeek', label: 'Last week', daysBack: 7 },
    { key: 'lastMonthWeek', label: 'Same week last month', monthsBack: 1 },
    { key: 'lastYearWeek', label: 'Same week last year', monthsBack: 12 },
  ],
  mtd: [
    { key: 'lastMonthPeriod', label: 'Same period last month', monthsBack: 1 },
    { key: 'lastYearPeriod', label: 'Same period last year', monthsBack: 12 },
  ],
  lastMonth: [
    { key: 'monthBefore', label: 'The month before that', monthsBack: 1 },
    { key: 'lastYearSameMonth', label: 'Same month last year', monthsBack: 12 },
  ],
  last3: [
    { key: 'prev3Months', label: 'The previous 3 months', monthsBack: 3 },
    { key: 'lastYearSame3', label: 'Same 3 months last year', monthsBack: 12 },
  ],
};

function compareOptionsFor(preset: PresetKey | null, from: string, to: string): CompareOption[] {
  // `from`/`to` are empty strings whenever there's no data yet to range over
  // (e.g. right after a fresh cloud sync, before any transactions have
  // landed) — there's nothing to compare in that case, and feeding an empty
  // string into the date math below would produce an Invalid Date and throw.
  if (preset === null || !from || !to) return [];
  const span = daysInclusive(from, to);
  return COMPARE_SHIFTS[preset].map(({ key, label, monthsBack, daysBack }) => {
    const compTo = daysBack !== undefined ? addDaysISO(to, -daysBack) : addCalendarMonths(to, -(monthsBack ?? 0));
    const compFrom = addDaysISO(compTo, -(span - 1));
    return { key, label, range: { from: compFrom, to: compTo } };
  });
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

  // Which preset (if any) is driving the range — null means the user typed a
  // custom From/To. Tracking this explicitly (rather than comparing dates
  // back against each preset's formula) means the active button stays
  // correctly highlighted, and re-applies itself under the new definition,
  // if the user changes their pay-cycle or week-start-day setting while a
  // preset is selected.
  const [preset, setPreset] = useState<PresetKey | null>('mtd');
  const [from, setFrom] = useState(() => presetRange('mtd', monthStartDay, weekStartDay, dateBounds).from);
  const [to, setTo] = useState(() => presetRange('mtd', monthStartDay, weekStartDay, dateBounds).to);

  // Which comparison option (if any) is active — keyed off `preset` so a
  // stale option from a different preset's set (or from a hand-typed custom
  // range) never lingers when the user switches away.
  const [compareKey, setCompareKey] = useState<string | null>(null);

  useEffect(() => {
    if (preset === null || !dateBounds.max) return;
    const range = presetRange(preset, monthStartDay, weekStartDay, dateBounds);
    setFrom(range.from);
    setTo(range.to);
  }, [preset, monthStartDay, weekStartDay, dateBounds.min, dateBounds.max]);

  useEffect(() => {
    setCompareKey(null);
  }, [preset]);

  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;

  // Filter the raw transactions to the exact selected days first, then bucket
  // — this keeps day/week/month views all honoring the same precise range,
  // instead of only being able to clip at month boundaries.
  const rangedTransactions = useMemo(
    () => transactions.filter((t) => t.date >= lo && t.date <= hi),
    [transactions, lo, hi],
  );

  // Driven by the same ranged transactions as the chart below, so the
  // Overview cards always describe whatever the date range controls above
  // are currently showing, not the card's whole history.
  const overview = useMemo(
    () => buildOverview(rangedTransactions, monthStartDay, categoryOf, weekStartDay),
    [rangedTransactions, monthStartDay, categoryOf, weekStartDay],
  );

  const compareOptions = useMemo(() => compareOptionsFor(preset, from, to), [preset, from, to]);
  const activeCompare = compareOptions.find((o) => o.key === compareKey) ?? null;

  const compareOverview = useMemo(() => {
    if (!activeCompare) return null;
    const { from: cFrom, to: cTo } = activeCompare.range;
    const txs = transactions.filter((t) => t.date >= cFrom && t.date <= cTo);
    return buildOverview(txs, monthStartDay, categoryOf, weekStartDay);
  }, [activeCompare, transactions, monthStartDay, categoryOf, weekStartDay]);

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
    setPreset(key);
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
          <div className="controls-left">
            <div className="seg seg-sm">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={preset === p.key ? 'seg-on' : ''}
                  onClick={() => applyPreset(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <CompareMenu options={compareOptions} activeKey={compareKey} onSelect={setCompareKey} />
          </div>
          <div className="range-pickers">
            <label className="picker">
              <span className="picker-label">From</span>
              <input
                type="date"
                value={lo}
                min={dateBounds.min}
                max={dateBounds.max}
                onChange={(e) => {
                  setPreset(null);
                  setFrom(e.target.value);
                }}
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
                onChange={(e) => {
                  setPreset(null);
                  setTo(e.target.value);
                }}
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
      <KpiCards overview={overview} compareOverview={compareOverview} compareLabel={activeCompare?.label} />

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
