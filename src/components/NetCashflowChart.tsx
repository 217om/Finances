import {
  Bar,
  Cell,
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
  months: (MonthlySummary & { netMA: number | null })[];
}

const POS = '#16a34a';
const NEG = '#dc2626';
const LINE = '#0f172a';

export default function NetCashflowChart({ months }: Props) {
  if (months.length === 0) return <Empty />;

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={months} margin={{ top: 10, right: 8, bottom: 4, left: 8 }}>
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
          <Tooltip content={<NetTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
          <ReferenceLine y={0} stroke="#cbd5e1" />
          <Bar dataKey="net" radius={[3, 3, 0, 0]} maxBarSize={42}>
            {months.map((m) => (
              <Cell key={m.month} fill={m.net >= 0 ? POS : NEG} fillOpacity={0.85} />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="netMA"
            stroke={LINE}
            strokeWidth={2}
            dot={false}
            connectNulls
            name="3-mo avg"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function NetTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload as MonthlySummary & { netMA: number | null };
  return (
    <div className="tooltip">
      <div className="tooltip-title">{monthLabel(label)}</div>
      <Row label="Net" value={money(m.net)} tone={m.net >= 0 ? 'pos' : 'neg'} />
      <Row label="Income" value={money(m.income)} />
      <Row label="Expenses" value={money(m.expenses)} />
      {m.netMA !== null && <Row label="3-mo avg" value={money(m.netMA)} />}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="tooltip-row">
      <span>{label}</span>
      <span className={tone ?? ''}>{value}</span>
    </div>
  );
}

function Empty() {
  return <div className="chart-empty">No months to show in this range.</div>;
}
