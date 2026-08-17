import { describe, expect, it } from 'vitest';
import { categorize, mergeByKey, signatureOf, INCOME_CATEGORY } from './categorize';

describe('categorize', () => {
  it('treats any non-negative amount as income, regardless of description', () => {
    expect(categorize('SALARY XYZ CORP', 1200)).toBe(INCOME_CATEGORY);
    expect(categorize('random text', 0)).toBe(INCOME_CATEGORY);
  });

  it('matches a negative amount against the built-in keyword rules', () => {
    expect(categorize('CARREFOUR HYPERMARKET', -45.5)).toBe('Groceries');
    expect(categorize('STARBUCKS COFFEE', -4.2)).toBe('Dining');
    expect(categorize('UBER TRIP', -8.5)).toBe('Transport');
    expect(categorize('NETFLIX SUBSCRIPTION', -6.99)).toBe('Entertainment');
  });

  it('falls back to Other when nothing matches', () => {
    expect(categorize('XZQVJ UNKNOWN MERCHANT 42', -10)).toBe('Other');
  });

  it('the first matching rule wins when a description could match more than one', () => {
    // "grocery store" matches both Groceries (grocer) and Shopping (store) —
    // Groceries is listed first in the built-in rule table.
    expect(categorize('LOCAL GROCERY STORE', -20)).toBe('Groceries');
  });
});

describe('signatureOf', () => {
  it('reduces similar descriptions to the same merchant signature', () => {
    expect(signatureOf('ADNOC Petrol')).toBe(signatureOf('ADNOC Petrol Station Marina'));
  });

  it('drops noise words like POS/purchase/card markers', () => {
    expect(signatureOf('POS PURCHASE CARREFOUR')).toBe(signatureOf('CARREFOUR HYPERMARKET'));
  });

  it('falls back to something stable even with no significant tokens', () => {
    expect(signatureOf('123 456')).toBeTruthy();
    expect(signatureOf('')).toBe('misc');
  });
});

describe('mergeByKey', () => {
  it("a card-specific entry shadows a global one with the same key", () => {
    const merged = mergeByKey(
      [{ id: 'a', v: 'global' }],
      [{ id: 'a', v: 'card' }],
      (x) => x.id,
    );
    expect(merged).toEqual([{ id: 'a', v: 'card' }]);
  });

  it('keeps entries that only exist on one side', () => {
    const merged = mergeByKey(
      [{ id: 'a', v: 1 }],
      [{ id: 'b', v: 2 }],
      (x) => x.id,
    );
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });
});
