import {
  Bar,
  BarChart,
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

export default function IncomeExpenseChart({ months }: Props) {
  if (months.length === 0) {
    return <div className="chart-empty">No months to show in this range.</div>;
  }

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={months} margin={{ top: 10, right: 8, bottom: 4, left: 8 }} barGap={2}>
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
          <Tooltip content={<IeTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
          <Bar dataKey="income" name="Income" fill={INCOME} radius={[3, 3, 0, 0]} maxBarSize={20} />
          <Bar dataKey="expenses" name="Expenses" fill={EXPENSE} radius={[3, 3, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
      <div className="legend">
        <span className="legend-item">
          <span className="dot" style={{ background: INCOME }} /> Income
        </span>
        <span className="legend-item">
          <span className="dot" style={{ background: EXPENSE }} /> Expenses
        </span>
      </div>
    </div>
  );
}

function IeTooltip({ active, payload, label }: any) {
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
      <div className="tooltip-row">
        <span>Net</span>
        <span className={m.net >= 0 ? 'pos' : 'neg'}>{money(m.net)}</span>
      </div>
    </div>
  );
}
