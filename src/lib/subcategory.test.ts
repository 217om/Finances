import { describe, expect, it } from 'vitest';
import { makeSubResolver, UNSORTED } from './subcategory';
import type { SubRule } from '../types';

describe('makeSubResolver', () => {
  const rule = (over: Partial<SubRule>): SubRule => ({
    id: `${over.parent ?? 'Transfers'}${over.keyword ?? 'x'}`,
    parent: 'Transfers',
    keyword: 'x',
    sub: 'Other',
    createdAt: 0,
    ...over,
  });

  it('resolves to the matching sub-rule for the parent category', () => {
    const rules = [rule({ keyword: 'salary', sub: 'Paycheck' })];
    const resolver = makeSubResolver(rules, []);
    expect(
      resolver.subOf({ id: '1', description: 'SALARY TRANSFER', amount: 1000 } as any, 'Transfers'),
    ).toBe('Paycheck');
  });

  it('falls back to Unsorted when nothing matches', () => {
    const resolver = makeSubResolver([], []);
    expect(
      resolver.subOf({ id: '1', description: 'RANDOM', amount: -5 } as any, 'Transfers'),
    ).toBe(UNSORTED);
  });

  it('the higher-priority rule wins regardless of creation order', () => {
    const older = rule({ keyword: 'amazon', sub: 'Shopping', priority: 5, createdAt: 1 });
    const newer = rule({ keyword: 'amazon', sub: 'Subscriptions', priority: 1, createdAt: 2 });
    const resolver = makeSubResolver([older, newer], []);
    expect(
      resolver.subOf({ id: '1', description: 'AMAZON PRIME', amount: -10 } as any, 'Transfers'),
    ).toBe('Shopping');
  });

  it('falls back to newest-first when priorities are tied', () => {
    const older = rule({ keyword: 'amazon', sub: 'Shopping', priority: 3, createdAt: 1 });
    const newer = rule({ keyword: 'amazon', sub: 'Subscriptions', priority: 3, createdAt: 2 });
    const resolver = makeSubResolver([older, newer], []);
    expect(
      resolver.subOf({ id: '1', description: 'AMAZON PRIME', amount: -10 } as any, 'Transfers'),
    ).toBe('Subscriptions');
  });

  it('treats a missing priority as 1 (lowest)', () => {
    const noPriority = rule({ keyword: 'amazon', sub: 'Shopping', createdAt: 5 });
    const explicit = rule({ keyword: 'amazon', sub: 'Subscriptions', priority: 2, createdAt: 1 });
    const resolver = makeSubResolver([noPriority, explicit], []);
    expect(
      resolver.subOf({ id: '1', description: 'AMAZON PRIME', amount: -10 } as any, 'Transfers'),
    ).toBe('Subscriptions');
  });

  it('a manual sub-override always wins over a sub-rule', () => {
    const rules = [rule({ keyword: 'amazon', sub: 'Shopping', priority: 10 })];
    const overrides = [{ id: '1', parent: 'Transfers', sub: 'Manual' }];
    const resolver = makeSubResolver(rules, overrides as any);
    expect(
      resolver.subOf({ id: '1', description: 'AMAZON PRIME', amount: -10 } as any, 'Transfers'),
    ).toBe('Manual');
  });
});
