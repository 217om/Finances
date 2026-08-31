import { Line, LineChart, ResponsiveContainer } from 'recharts';
import type { NetWorthPoint } from '../lib/balances';

interface Props {
  points: NetWorthPoint[];
  /** Colors the line green (true) or red (false) — the same convention as
   *  the balance figure itself, not the direction it moved. */
  positive: boolean;
  /** Dates (matching `points[i].date`) to mark with a visible dot — e.g. the
   *  Executive Summary's period boundaries, so the chart's shape can be read
   *  against the table underneath it. Every other point stays undotted. */
  markerDates?: Set<string>;
}

/** A tiny, axis-free trend line for one card's balance history — just enough
 *  to see the shape at a glance next to the current figure. */
export default function Sparkline({ points, positive, markerDates }: Props) {
  return (
    <div className="sparkline">
      <ResponsiveContainer width="100%" height={32}>
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="stepAfter"
            dataKey="amount"
            stroke={positive ? 'var(--pos)' : 'var(--neg)'}
            strokeWidth={1.5}
            dot={
              markerDates && markerDates.size > 0
                ? (props: { cx: number; cy: number; payload: NetWorthPoint; key: string }) =>
                    markerDates.has(props.payload.date) ? (
                      <circle
                        key={props.key}
                        cx={props.cx}
                        cy={props.cy}
                        r={3}
                        fill={positive ? 'var(--pos)' : 'var(--neg)'}
                        stroke="var(--surface)"
                        strokeWidth={1}
                      />
                    ) : (
                      <g key={props.key} />
                    )
                : false
            }
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
