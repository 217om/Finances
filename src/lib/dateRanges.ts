// Preset date ranges for the notes "Insert value" picker — plain ISO date
// math, kept independent of the user's local timezone quirks the same way
// aggregate.ts does.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function monthBounds(iso: string, monthsAgo: number): { from: string; to: string } {
  const [y, m] = iso.split('-').map(Number);
  const idx = y * 12 + (m - 1) - monthsAgo;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const from = `${ny}-${pad2(nm)}-01`;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const to = `${ny}-${pad2(nm)}-${pad2(lastDay)}`;
  return { from, to };
}

export type RangePreset = 'all' | 'thisMonth' | 'lastMonth' | 'last7' | 'last30' | 'thisYear' | 'custom';

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'thisYear', label: 'This year' },
  { key: 'custom', label: 'Custom range…' },
];

/** Resolve a preset (as of today) to a concrete inclusive [from, to], or
 *  null for "all time" (no range args needed). */
export function resolvePreset(preset: RangePreset): { from: string; to: string } | null {
  const today = todayISO();
  switch (preset) {
    case 'all':
      return null;
    case 'thisMonth':
      return { from: monthBounds(today, 0).from, to: today };
    case 'lastMonth':
      return monthBounds(today, 1);
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return null;
  }
}
