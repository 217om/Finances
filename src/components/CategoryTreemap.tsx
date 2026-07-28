import { ResponsiveContainer, Treemap } from 'recharts';
import { money } from '../lib/format';

export interface TreemapCell {
  name: string;
  value: number;
  color: string;
}

interface Props {
  data: TreemapCell[];
  onSelect?: (name: string) => void;
  selected?: string | null;
}

/** Pick readable text color (black/white) for a given hex background. */
function textColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#EBDCC4';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#181818' : '#F5EFE4';
}

export default function CategoryTreemap({ data, onSelect, selected }: Props) {
  if (data.length === 0) {
    return <div className="chart-empty">Nothing to show here.</div>;
  }
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={360}>
        <Treemap
          data={data}
          dataKey="value"
          nameKey="name"
          isAnimationActive={false}
          content={<TreeCell onSelect={onSelect} selected={selected} />}
        />
      </ResponsiveContainer>
    </div>
  );
}

function TreeCell(props: any) {
  const { x, y, width, height, name, value, color, onSelect, selected } = props;
  if (width <= 0 || height <= 0 || !name) return null;
  const fill = color || '#7A6F63';
  const fg = textColor(fill);
  const showLabel = width > 54 && height > 22;
  const isSelected = selected && name === selected;
  return (
    <g
      className="treemap-cell"
      onClick={() => onSelect && onSelect(name)}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      <rect
        className="treemap-cell-rect"
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={isSelected ? 1 : 0.9}
        stroke={isSelected ? 'var(--accent)' : 'var(--surface)'}
        strokeWidth={isSelected ? 2.5 : 2}
        rx={3}
      />
      {showLabel && (
        <text x={x + 8} y={y + 19} fontSize={12} fontWeight={600} fill={fg}>
          {name.length > width / 8 ? `${name.slice(0, Math.max(3, Math.floor(width / 8)))}…` : name}
        </text>
      )}
      {showLabel && height > 40 && (
        <text x={x + 8} y={y + 35} fontSize={11} fill={fg} fillOpacity={0.85}>
          {money(value, { compact: true })}
        </text>
      )}
    </g>
  );
}
