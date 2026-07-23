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
