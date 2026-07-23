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
import {
  dayLabel,
  dayLabelShort,
  money,
  monthLabel,
  monthLabelShort,
  weekLabel,
  weekLabelShort,
} from '../lib/format';

export type Granularity = 'month' | 'week' | 'day';

interface Props {
  months: MonthlySummary[];
  granularity?: Granularity;
}

const INCOME = '#0ea5e9';
const EXPENSE = '#f97316';
const NET = '#0f172a';

const FULL_LABEL: Record<Granularity, (key: string) => string> = {
  month: monthLabel,
  week: weekLabel,
  day: dayLabel,
};

const SHORT_LABEL: Record<Granularity, (key: string) => string> = {
  month: monthLabelShort,
  week: weekLabelShort,
  day: dayLabelShort,
};

/**
 * The one cashflow chart: income and expense bars with the net as a line on
 * top — components and result in a single view. Granularity controls whether
 * each bar is a month, a week, or a day.
 */
export default function MonthlyCashflowChart({ months, granularity = 'month' }: Props) {
  if (months.length === 0) {
    return <div className="chart-empty">No data to show in this range.</div>;
  }

  const shortLabel = SHORT_LABEL[granularity];

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={months} margin={{ top: 10, right: 8, bottom: 4, left: 8 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef1f5" />
          <XAxis
            dataKey="month"
            tickFormatter={shortLabel}
            tick={{ fontSize: 11, fill: '#64748b' }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => money(v, { compact: true })}
            tick={{ fontSize: 11, fill: '#64748b' }}
            width={64}
          />
          <Tooltip
            content={<CashflowTooltip granularity={granularity} />}
            cursor={{ fill: 'rgba(15,23,42,0.04)' }}
          />
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

function CashflowTooltip({ active, payload, label, granularity }: any) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload as MonthlySummary;
  const fullLabel = FULL_LABEL[(granularity as Granularity) ?? 'month'];
  return (
    <div className="tooltip">
      <div className="tooltip-title">{fullLabel(label)}</div>
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
