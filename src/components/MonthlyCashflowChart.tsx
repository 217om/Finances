import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthlySummary } from '../types';
import { money, monthLabel, monthLabelShort } from '../lib/format';

interface Props {
  months: MonthlySummary[];
}

const INCOME = '#0ea5e9';
const EXPENSE = '#f97316';
const NET = '#0f172a';

/**
 * The one cashflow chart: income and expense bars each month, with the net as a
 * line on top — components and result in a single view.
 */
export default function MonthlyCashflowChart({ months }: Props) {
  if (months.length === 0) {
    return <div className="chart-empty">No months to show in this range.</div>;
  }

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={months} margin={{ top: 10, right: 8, bottom: 4, left: 8 }} barGap={2}>
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
          <Tooltip content={<CashflowTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
          <ReferenceLine y={0} stroke="#cbd5e1" />
          <Bar dataKey="income" name="Income" fill={INCOME} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expenses" name="Expenses" fill={EXPENSE} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Line
            type="monotone"
            dataKey="net"
            name="Net"
            stroke={NET}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend">
        <span className="legend-item">
          <span className="dot" style={{ background: INCOME }} /> Income
        </span>
        <span className="legend-item">
          <span className="dot" style={{ background: EXPENSE }} /> Expenses
        </span>
        <span className="legend-item">
          <span className="dot" style={{ background: NET }} /> Net
        </span>
      </div>
    </div>
  );
}

function CashflowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload as MonthlySummary;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{monthLabel(label)}</div>
      <div className="tooltip-row">
        <span>Income</span>
        <span>{money(m.income)}</span>
      </div>
      <div className="tooltip-row">
        <span>Expenses</span>
        <span>{money(m.expenses)}</span>
      </div>
      <div className="tooltip-row tooltip-total">
        <span>Net</span>
        <span className={m.net >= 0 ? 'pos' : 'neg'}>{money(m.net)}</span>
      </div>
    </div>
  );
}
