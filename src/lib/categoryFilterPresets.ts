// Named, reusable snapshots of a category filter (see categoryFilter.ts) —
// "hide transfers and gifts", "everything visible", etc. Presets are global,
// not tied to a card or to the combined view: the same saved preset can be
// applied to a single card's own filter or to the combined view's
// independent one, since they're both just a set of category/sub names.
//
// A preset is an allow-list, not a snapshot of what was excluded: it
// remembers which categories/subs were checked when saved, and anything
// else — including a category created after the preset was saved — is
// treated as unchecked. Otherwise a brand-new category would silently show
// up as "included" in every old preset the moment it exists, which defeats
// the point of a preset being a deliberate, closed set.

import {
  isCategoryExcluded,
  isSubExcluded,
  isValidCategoryFilter,
  type CategoryFilterState,
} from './categoryFilter';

export interface IncludedCategoryPreset {
  id: string;
  name: string;
  /** Categories this preset keeps visible. Anything not listed here is
   *  hidden when the preset is applied, regardless of whether it existed
   *  yet at save time. */
  includedCategories: string[];
  /** Per-parent list of included sub-category names — same allow-list
   *  model, only meaningful for a parent that's itself included. */
  includedSubs: Record<string, string[]>;
  /** When the name/contents last changed — lets sync-restore keep whichever
   *  of two conflicting copies is newer instead of letting the restored one
   *  blindly win. Optional only for records written before this existed. */
  updatedAt?: number;
}

/** Pre-fix preset shape: a raw snapshot of what was excluded. Still read
 *  (so nothing existing silently disappears) and still resolves the exact
 *  same way it always did — a category added after one of these was saved
 *  won't be hidden by it. Delete and re-save it to switch to the allow-list
 *  behavior above. */
interface LegacyCategoryFilterPreset {
  id: string;
  name: string;
  filter: CategoryFilterState;
  /** See IncludedCategoryPreset.updatedAt — same purpose. */
  updatedAt?: number;
}

export type CategoryFilterPreset = IncludedCategoryPreset | LegacyCategoryFilterPreset;

function isLegacyPreset(p: CategoryFilterPreset): p is LegacyCategoryFilterPreset {
  return 'filter' in p;
}

export function makePreset(
  name: string,
  includedCategories: string[],
  includedSubs: Record<string, string[]>,
): CategoryFilterPreset {
  const id = `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { id, name, includedCategories, includedSubs, updatedAt: Date.now() };
}

/** Captures which categories/subs `filter` currently leaves visible, out of
 *  `allCategories`/`subsForParent` — the allow-list a new preset remembers. */
export function captureIncluded(
  filter: CategoryFilterState,
  allCategories: string[],
  subsForParent: (category: string) => string[],
): { includedCategories: string[]; includedSubs: Record<string, string[]> } {
  const includedCategories = allCategories.filter((c) => !isCategoryExcluded(filter, c));
  const includedSubs: Record<string, string[]> = {};
  for (const cat of includedCategories) {
    const subs = subsForParent(cat).filter((s) => !isSubExcluded(filter, cat, s));
    if (subs.length > 0) includedSubs[cat] = subs;
  }
  return { includedCategories, includedSubs };
}

/** Resolves a preset into an actual exclude-based filter against the
 *  CURRENT set of known categories — anything not in the preset's included
 *  list ends up excluded, including a category that didn't exist when the
 *  preset was saved. A legacy preset instead applies its original snapshot
 *  as-is, unchanged from its old behavior. */
export function resolvePresetFilter(
  preset: CategoryFilterPreset,
  allCategories: string[],
  subsForParent: (category: string) => string[],
): CategoryFilterState {
  if (isLegacyPreset(preset)) return preset.filter;
  const includedSet = new Set(preset.includedCategories);
  const categories = allCategories.filter((c) => !includedSet.has(c));
  const subs: Record<string, string[]> = {};
  for (const cat of preset.includedCategories) {
    const includedSubsSet = new Set(preset.includedSubs[cat] ?? []);
    const excluded = subsForParent(cat).filter((s) => !includedSubsSet.has(s));
    if (excluded.length > 0) subs[cat] = excluded;
  }
  return { categories, subs };
}

function isValidPreset(v: unknown): v is CategoryFilterPreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return false;
  if (Array.isArray(p.includedCategories) && typeof p.includedSubs === 'object' && p.includedSubs !== null) {
    return true;
  }
  return isValidCategoryFilter(p.filter);
}

export function isValidPresetList(v: unknown): v is CategoryFilterPreset[] {
  return Array.isArray(v) && v.every(isValidPreset);
}

/** Merges two preset lists by id — anything only on one side is kept as-is;
 *  for an id on both sides, whichever copy has the later updatedAt wins
 *  (missing treated as oldest), so restoring an older backup can't silently
 *  undo a newer local rename. Used when restoring a backup, so it's
 *  additive here too rather than wiping out presets created since. */
export function mergePresets(
  existing: CategoryFilterPreset[],
  incoming: CategoryFilterPreset[],
): CategoryFilterPreset[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const p of incoming) {
    const cur = byId.get(p.id);
    if (!cur || (p.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) byId.set(p.id, p);
  }
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
