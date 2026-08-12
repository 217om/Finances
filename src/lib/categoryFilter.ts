// Lets the user exclude specific categories or sub-categories from being
// counted anywhere — Dashboard KPIs/charts, category breakdown, Insights — not
// just hidden visually. Useful for things that aren't real spending, like a
// transfer to your own savings account. Stored in localStorage: it's a small
// display/calculation preference, not transaction data, so it doesn't need an
// IndexedDB version bump (and the migration hazard that comes with one).

export interface CategoryFilterState {
  /** Top-level categories excluded entirely. */
  categories: string[];
  /** Per-parent list of excluded sub-category names. */
  subs: Record<string, string[]>;
}

export function defaultCategoryFilter(): CategoryFilterState {
  return { categories: [], subs: {} };
}

export function isCategoryExcluded(filter: CategoryFilterState, category: string): boolean {
  return filter.categories.includes(category);
}

export function isSubExcluded(filter: CategoryFilterState, category: string, sub: string): boolean {
  return (filter.subs[category] ?? []).includes(sub);
}

/** True if a transaction with this resolved category (+ optional sub) should be excluded. */
export function isExcluded(
  filter: CategoryFilterState,
  category: string,
  sub: string | null,
): boolean {
  if (isCategoryExcluded(filter, category)) return true;
  if (sub && isSubExcluded(filter, category, sub)) return true;
  return false;
}

export function toggleCategory(filter: CategoryFilterState, category: string): CategoryFilterState {
  const on = isCategoryExcluded(filter, category);
  return {
    ...filter,
    categories: on
      ? filter.categories.filter((c) => c !== category)
      : [...filter.categories, category],
  };
}

export function toggleSub(
  filter: CategoryFilterState,
  category: string,
  sub: string,
): CategoryFilterState {
  const list = filter.subs[category] ?? [];
  const on = list.includes(sub);
  const nextList = on ? list.filter((s) => s !== sub) : [...list, sub];
  return { ...filter, subs: { ...filter.subs, [category]: nextList } };
}

/** True once the user has hidden at least one category or sub-category —
 *  signals this filter is a deliberate, narrowed-down subset rather than the
 *  untouched "show everything" default. */
export function isCuratedFilter(filter: CategoryFilterState): boolean {
  return filter.categories.length > 0 || Object.values(filter.subs).some((list) => list.length > 0);
}

/** Applied when a brand-new category is created: if the filter is still the
 *  untouched default, a new category should stay visible like everything
 *  else. But once the user has deliberately narrowed the filter down to a
 *  subset, a category that didn't exist yet at the time shouldn't silently
 *  reappear in every chart and total the moment it's created — it stays
 *  hidden until explicitly checked back on, same as a saved preset treats
 *  anything outside its allow-list. */
export function excludeNewCategory(filter: CategoryFilterState, category: string): CategoryFilterState {
  if (!isCuratedFilter(filter) || isCategoryExcluded(filter, category)) return filter;
  return { ...filter, categories: [...filter.categories, category] };
}

export function excludedCount(filter: CategoryFilterState): number {
  return (
    filter.categories.length +
    Object.values(filter.subs).reduce((a, list) => a + list.length, 0)
  );
}

export function isValidCategoryFilter(v: unknown): v is CategoryFilterState {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return Array.isArray(f.categories) && typeof f.subs === 'object' && f.subs !== null;
}

/** Combines two filters so nothing either one hides gets un-hidden — used
 *  when restoring a backup on top of an existing filter, so restore is
 *  additive here too, matching the rest of the restore process. */
export function unionCategoryFilter(a: CategoryFilterState, b: CategoryFilterState): CategoryFilterState {
  const categories = [...new Set([...a.categories, ...b.categories])];
  const subs: Record<string, string[]> = {};
  for (const parent of new Set([...Object.keys(a.subs), ...Object.keys(b.subs)])) {
    subs[parent] = [...new Set([...(a.subs[parent] ?? []), ...(b.subs[parent] ?? [])])];
  }
  return { categories, subs };
}
