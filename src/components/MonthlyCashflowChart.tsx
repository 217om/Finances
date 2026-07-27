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
  /** Called with the clicked bucket's key (a day, week-start, or pay-cycle
   *  month) when the user clicks a point on the chart. */
  onPeriodClick?: (key: string) => void;
}

const INCOME = 'var(--pos)';
const EXPENSE = 'var(--accent)';
const NET = 'var(--text)';

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
export default function MonthlyCashflowChart({ months, granularity = 'month', onPeriodClick }: Props) {
  if (months.length === 0) {
    return <div className="chart-empty">No data to show in this range.</div>;
  }

  const shortLabel = SHORT_LABEL[granularity];

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart
          data={months}
          margin={{ top: 10, right: 8, bottom: 4, left: 8 }}
          barGap={2}
          style={onPeriodClick ? { cursor: 'pointer' } : undefined}
          onClick={(e) => {
            const key = e?.activeLabel;
            if (onPeriodClick && typeof key === 'string') onPeriodClick(key);
          }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="month"
            tickFormatter={shortLabel}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => money(v, { compact: true })}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            width={64}
          />
          <Tooltip
            content={<CashflowTooltip granularity={granularity} />}
            cursor={{ fill: 'rgba(220,159,133,0.08)' }}
          />
          <ReferenceLine y={0} stroke="var(--border)" />
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
