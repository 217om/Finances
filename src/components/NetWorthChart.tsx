import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { NetWorthPoint } from '../lib/balances';
import { dayLabel, dayLabelShort, money } from '../lib/format';

interface Props {
  points: NetWorthPoint[];
}

const LINE = 'var(--text)';

/**
 * Net worth over time — one point per date anything changed, held flat
 * between updates (a step, not a smoothed trend), since that's what actually
 * happened: nothing about a card or an asset moves except on those dates.
 */
export default function NetWorthChart({ points }: Props) {
  if (points.length < 2) {
    return <div className="chart-empty">Not enough history yet. Add a few balance updates to see a trend.</div>;
  }

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={points} margin={{ top: 10, right: 8, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE} stopOpacity={0.16} />
              <stop offset="100%" stopColor={LINE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            tickFormatter={dayLabelShort}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            tickFormatter={(v) => money(v, { compact: true })}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            width={64}
          />
          <Tooltip content={<NetWorthTooltip />} cursor={{ stroke: 'var(--border)' }} />
          <Area
            type="stepAfter"
            dataKey="amount"
            stroke={LINE}
            strokeWidth={2}
            fill="url(#netWorthFill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function NetWorthTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const amount = (payload[0].payload as NetWorthPoint).amount;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{dayLabel(label)}</div>
      <div className="tooltip-row tooltip-total">
        <span>Net worth</span>
        <span className={amount >= 0 ? 'pos' : 'neg'}>{money(amount)}</span>
      </div>
    </div>
  );
}
