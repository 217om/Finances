import { useMemo, useState } from 'react';
import type { Overview } from '../lib/aggregate';
import type { MonthlySummary } from '../types';
import { money, monthLabel } from '../lib/format';

interface Props {
  overview: Overview;
}

type Metric = 'spend' | 'net' | 'income';

const MONTH_ABBR = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const METRICS: { key: Metric; label: string }[] = [
  { key: 'spend', label: 'Spending' },
  { key: 'net', label: 'Net' },
  { key: 'income', label: 'Income' },
];

function valueOf(m: MonthlySummary, metric: Metric): number {
  if (metric === 'net') return m.net;
  if (metric === 'income') return m.income;
  return m.expenses;
}

/** Years × months grid colored by a chosen metric — reveals seasonality. */
export default function CalendarHeatmap({ overview }: Props) {
  const [metric, setMetric] = useState<Metric>('spend');

  const { years, byKey, max } = useMemo(() => {
    const byKey = new Map<string, MonthlySummary>();
    for (const m of overview.months) byKey.set(m.month, m);
    const active = overview.months.filter((m) => m.txCount > 0);
    if (active.length === 0) return { years: [] as number[], byKey, max: 0 };

    const minYear = Number(active[0].month.slice(0, 4));
    const maxYear = Number(active[active.length - 1].month.slice(0, 4));
    const years: number[] = [];
    for (let y = minYear; y <= maxYear; y++) years.push(y);

    let max = 0;
    for (const m of active) {
      const v = Math.abs(valueOf(m, metric));
      if (v > max) max = v;
    }
    return { years, byKey, max };
  }, [overview.months, metric]);

  if (years.length === 0) {
    return <p className="muted">Import some statements to see the calendar.</p>;
  }

  const cellStyle = (cell: MonthlySummary | undefined): React.CSSProperties => {
    if (!cell || cell.txCount === 0) return { background: '#f1f3f6' };
    const v = valueOf(cell, metric);
    const intensity = max > 0 ? Math.max(0.12, Math.min(1, Math.abs(v) / max)) : 0.12;
    let rgb: string;
    if (metric === 'net') rgb = v >= 0 ? '22, 163, 74' : '220, 38, 38';
    else if (metric === 'income') rgb = '14, 165, 233';
    else rgb = '249, 115, 22';
    return { background: `rgba(${rgb}, ${intensity})` };
  };

  return (
    <div>
      <div className="heat-controls">
        <div className="seg seg-sm">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={metric === m.key ? 'seg-on' : ''}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="heatmap">
        <div className="heat-row heat-head">
          <span className="heat-year" />
          {MONTH_ABBR.map((mon, i) => (
            <span key={i} className="heat-month-label">
              {mon}
            </span>
          ))}
        </div>
        {years.map((y) => (
          <div key={y} className="heat-row">
            <span className="heat-year">{y}</span>
            {Array.from({ length: 12 }, (_, i) => {
              const key = `${y}-${String(i + 1).padStart(2, '0')}`;
              const cell = byKey.get(key);
              const has = cell && cell.txCount > 0;
              return (
                <span
                  key={key}
                  className="heat-cell"
                  style={cellStyle(cell)}
                  title={
                    has ? `${monthLabel(key)} · ${money(valueOf(cell!, metric))}` : `${monthLabel(key)} · no data`
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
