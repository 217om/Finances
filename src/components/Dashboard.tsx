import { useEffect, useMemo, useState } from 'react';
import type { Overview } from '../lib/aggregate';
import { withMovingAverage } from '../lib/aggregate';
import { monthLabel } from '../lib/format';
import KpiCards from './KpiCards';
import NetCashflowChart from './NetCashflowChart';
import IncomeExpenseChart from './IncomeExpenseChart';
import MonthTable from './MonthTable';
import Sources from './Sources';
import CategoryBreakdown from './CategoryBreakdown';
import Insights from './Insights';

interface Props {
  overview: Overview;
  monthStartDay: number;
  pendingCount: number;
  onReview?: () => void;
}

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

export default function Dashboard({ overview, monthStartDay, pendingCount, onReview }: Props) {
  const keys = useMemo(() => overview.months.map((m) => m.month), [overview.months]);
  const first = keys[0];
  const last = keys[keys.length - 1];

  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);

  // Reset the window to the full range whenever the available span changes
  // (new data imported, or the month-start day regrouped the periods).
  useEffect(() => {
    setFrom(first);
    setTo(last);
  }, [first, last]);

  // Guard against an inverted selection.
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;

  const visible = useMemo(() => {
    // Moving average is computed over the full series so the left edge of the
    // visible window still reflects prior months.
    return withMovingAverage(overview.months).filter((m) => m.month >= lo && m.month <= hi);
  }, [overview.months, lo, hi]);

  const applyPreset = (count: number | 'all') => {
    if (count === 'all' || keys.length <= count) {
      setFrom(keys[0]);
    } else {
      setFrom(keys[keys.length - count]);
    }
    setTo(keys[keys.length - 1]);
  };

  const activePreset = (count: number | 'all'): boolean => {
    if (hi !== last) return false;
    if (count === 'all') return lo === first;
    return lo === keys[Math.max(0, keys.length - count)] && keys.length > count;
  };

  const cycleNote =
    monthStartDay > 1
      ? `Months run from the ${ordinal(monthStartDay)} to the ${ordinal(
          monthStartDay === 1 ? 31 : monthStartDay - 1,
        )}.`
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
      </section>

      <KpiCards overview={overview} />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Net cashflow by month</h2>
            <p className="muted">Money in minus money out. The line is a 3-month average.</p>
          </div>
        </div>
        <NetCashflowChart months={visible} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Income vs. expenses</h2>
            <p className="muted">How much came in and went out each month.</p>
          </div>
        </div>
        <IncomeExpenseChart months={visible} />
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Where your money goes</h2>
              <p className="muted">Spending by category over the selected range.</p>
            </div>
            {onReview && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onReview}>
                Review categories
                {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
              </button>
            )}
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

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h2>Monthly breakdown</h2>
          </div>
          <MonthTable months={visible} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Imported statements</h2>
          </div>
          <Sources sources={overview.sources} />
        </section>
      </div>
    </div>
  );
}
