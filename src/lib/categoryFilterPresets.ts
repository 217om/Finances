// Named, reusable snapshots of a category filter (see categoryFilter.ts) —
// "hide transfers and gifts", "everything visible", etc. Presets are global,
// not tied to a card or to the combined view: the same saved preset can be
// applied to a single card's own filter or to the combined view's
// independent one, since they're both just a set of category/sub names.

import { isValidCategoryFilter, type CategoryFilterState } from './categoryFilter';

export interface CategoryFilterPreset {
  id: string;
  name: string;
  filter: CategoryFilterState;
}

export function makePreset(name: string, filter: CategoryFilterState): CategoryFilterPreset {
  const id = `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { id, name, filter };
}

function isValidPreset(v: unknown): v is CategoryFilterPreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string' && isValidCategoryFilter(p.filter);
}

export function isValidPresetList(v: unknown): v is CategoryFilterPreset[] {
  return Array.isArray(v) && v.every(isValidPreset);
}

/** Merges two preset lists by id — an existing preset with the same id as
 *  an incoming one is replaced by the incoming version; anything else on
 *  either side is kept. Used when restoring a backup, so it's additive here
 *  too rather than wiping out presets created since the backup was made. */
export function mergePresets(
  existing: CategoryFilterPreset[],
  incoming: CategoryFilterPreset[],
): CategoryFilterPreset[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const p of incoming) byId.set(p.id, p);
  return [...byId.values()];
}

/** True if two filters exclude the exact same categories/sub-categories,
 *  ignoring order — used to highlight whichever saved preset (if any)
 *  matches what's currently applied. */
export function sameFilter(a: CategoryFilterState, b: CategoryFilterState): boolean {
  const sameSet = (x: string[], y: string[]) => {
    if (x.length !== y.length) return false;
    const s = new Set(x);
    return y.every((v) => s.has(v));
  };
  if (!sameSet(a.categories, b.categories)) return false;
  const aKeys = Object.keys(a.subs).filter((k) => (a.subs[k]?.length ?? 0) > 0);
  const bKeys = Object.keys(b.subs).filter((k) => (b.subs[k]?.length ?? 0) > 0);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => sameSet(a.subs[k] ?? [], b.subs[k] ?? []));
}
