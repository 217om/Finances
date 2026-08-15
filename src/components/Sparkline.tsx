import { Line, LineChart, ResponsiveContainer } from 'recharts';
import type { NetWorthPoint } from '../lib/balances';

interface Props {
  points: NetWorthPoint[];
  /** Colors the line green (true) or red (false) — the same convention as
   *  the balance figure itself, not the direction it moved. */
  positive: boolean;
}

/** A tiny, axis-free trend line for one card's balance history — just enough
 *  to see the shape at a glance next to the current figure. */
export default function Sparkline({ points, positive }: Props) {
  return (
    <div className="sparkline">
      <ResponsiveContainer width="100%" height={32}>
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="stepAfter"
            dataKey="amount"
            stroke={positive ? 'var(--pos)' : 'var(--neg)'}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
