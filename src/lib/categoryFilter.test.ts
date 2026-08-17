import { describe, expect, it } from 'vitest';
import { UNSORTED } from './subcategory';
import {
  defaultCategoryFilter,
  excludeNewCategory,
  isExcluded,
  toggleCategory,
  toggleSub,
  unionCategoryFilter,
} from './categoryFilter';

describe('toggleCategory / isExcluded', () => {
  it('excludes a whole category, and toggling again re-includes it', () => {
    let filter = defaultCategoryFilter();
    expect(isExcluded(filter, 'Transfers', 'Anything')).toBe(false);
    filter = toggleCategory(filter, 'Transfers');
    expect(isExcluded(filter, 'Transfers', 'Anything')).toBe(true);
    filter = toggleCategory(filter, 'Transfers');
    expect(isExcluded(filter, 'Transfers', 'Anything')).toBe(false);
  });
});

describe('toggleSub / isExcluded — the Unsorted-vs-named-sub case', () => {
  it('excluding just Unsorted under a category keeps the category and its named subs visible', () => {
    let filter = defaultCategoryFilter();
    filter = toggleSub(filter, 'Transfers', UNSORTED);
    // The category itself, and a real named sub-category, are unaffected.
    expect(isExcluded(filter, 'Transfers', 'Savings Move')).toBe(false);
    // Only the specific Unsorted bucket under Transfers is hidden.
    expect(isExcluded(filter, 'Transfers', UNSORTED)).toBe(true);
    // A different category's Unsorted bucket is untouched.
    expect(isExcluded(filter, 'Shopping', UNSORTED)).toBe(false);
  });

  it('excluding a named sub does not affect Unsorted or the rest of the category', () => {
    let filter = defaultCategoryFilter();
    filter = toggleSub(filter, 'Transfers', 'Savings Move');
    expect(isExcluded(filter, 'Transfers', 'Savings Move')).toBe(true);
    expect(isExcluded(filter, 'Transfers', UNSORTED)).toBe(false);
  });
});

describe('excludeNewCategory', () => {
  it('leaves a new category visible on the untouched default filter', () => {
    const filter = excludeNewCategory(defaultCategoryFilter(), 'Brand New');
    expect(isExcluded(filter, 'Brand New', null)).toBe(false);
  });

  it('hides a new category once the filter has been deliberately narrowed', () => {
    const curated = toggleCategory(defaultCategoryFilter(), 'Something Else');
    const filter = excludeNewCategory(curated, 'Brand New');
    expect(isExcluded(filter, 'Brand New', null)).toBe(true);
  });
});

describe('unionCategoryFilter', () => {
  it('hides anything either side hides — nothing gets un-hidden by merging', () => {
    const a = toggleCategory(defaultCategoryFilter(), 'Transfers');
    const b = toggleSub(defaultCategoryFilter(), 'Housing', UNSORTED);
    const merged = unionCategoryFilter(a, b);
    expect(isExcluded(merged, 'Transfers', null)).toBe(true);
    expect(isExcluded(merged, 'Housing', UNSORTED)).toBe(true);
    expect(isExcluded(merged, 'Housing', 'Rent')).toBe(false);
  });
});
