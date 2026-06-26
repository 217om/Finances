import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthlySummary } from '../types';
import { categoryTotals } from '../lib/aggregate';
import { categoryColor } from '../lib/categorize';
import { money, monthLabel, monthLabelShort } from '../lib/format';

interface Props {
  months: MonthlySummary[];
}

type Mode = 'stacked' | 'lines';

const DEFAULT_TOP = 6;

/**
 * Spending per category over the visible range. The category chips double as a
 * filter: toggle categories on/off to focus on specific ones.
 */
export default function CategoryTrends({ months }: Props) {
  const ordered = useMemo(() => categoryTotals(months).map((t) => t.category), [months]);
  const [mode, setMode] = useState<Mode>('stacked');
  const [selected, setSelected] = useState<Set<string> | null>(null);

  // Default to the biggest few categories until the user changes the selection.
  const active = selected ?? new Set(ordered.slice(0, DEFAULT_TOP));
  const selectedList = ordered.filter((c) => active.has(c));

  const data = useMemo(
    () =>
      months.map((m) => {
        const row: Record<string, number | string> = { month: m.month };
        for (const c of selectedList) row[c] = m.categories[c] ?? 0;
        return row;
      }),
    [months, selectedList],
  );

  if (ordered.length === 0) {
    return <p className="muted">No categorized spending in this range yet.</p>;
  }

  const toggle = (c: string) => {
    const next = new Set(active);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setSelected(next);
  };

  return (
    <div>
      <div className="trends-controls">
        <div className="seg seg-sm">
          <button type="button" className={mode === 'stacked' ? 'seg-on' : ''} onClick={() => setMode('stacked')}>
            Stacked
          </button>
          <button type="button" className={mode === 'lines' ? 'seg-on' : ''} onClick={() => setMode('lines')}>
            Lines
          </button>
        </div>
        <div className="trends-quick">
          <button type="button" className="linklike" onClick={() => setSelected(new Set(ordered.slice(0, DEFAULT_TOP)))}>
            Top {DEFAULT_TOP}
          </button>
          <button type="button" className="linklike" onClick={() => setSelected(new Set(ordered))}>
            All
          </button>
          <button type="button" className="linklike" onClick={() => setSelected(new Set())}>
            None
          </button>
        </div>
      </div>

      <div className="cat-chips">
        {ordered.map((c) => (
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

      {selectedList.length === 0 ? (
        <div className="chart-empty">Pick a category above to see its trend.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f5" />
            <XAxis
              dataKey="month"
              tickFormatter={monthLabelShort}
              tick={{ fontSize: 11, fill: '#64748b' }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v) => money(v, { compact: true })}
              tick={{ fontSize: 11, fill: '#64748b' }}
              width={64}
            />
            <Tooltip content={<TrendsTooltip />} cursor={{ stroke: '#cbd5e1' }} />
            {selectedList.map((c) =>
              mode === 'stacked' ? (
                <Area
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stackId="1"
                  stroke={categoryColor(c)}
                  fill={categoryColor(c)}
                  fillOpacity={0.65}
                />
              ) : (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={categoryColor(c)}
                  strokeWidth={2}
                  dot={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function TrendsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p: any) => (p.value ?? 0) > 0)
    .sort((a: any, b: any) => b.value - a.value);
  const total = payload.reduce((a: number, p: any) => a + (p.value ?? 0), 0);
  return (
    <div className="tooltip">
      <div className="tooltip-title">{monthLabel(label)}</div>
      {rows.map((p: any) => (
        <div className="tooltip-row" key={p.dataKey}>
          <span>
            <span className="catdot" style={{ background: p.color ?? p.stroke }} /> {p.dataKey}
          </span>
          <span>{money(p.value)}</span>
        </div>
      ))}
      <div className="tooltip-row tooltip-total">
        <span>Total</span>
        <span>{money(total)}</span>
      </div>
    </div>
  );
}
