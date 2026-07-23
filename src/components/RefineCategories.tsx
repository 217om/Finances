import { useMemo, useState } from 'react';
import type { KeywordRule, Transaction } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryColor } from '../lib/categorize';
import { money } from '../lib/format';
import CategoryPicker from './CategoryPicker';

interface Props {
  transactions: Transaction[];
  keywordRules: KeywordRule[];
  customCategories: string[];
  /** Current resolved category of a transaction, for the "from → to" preview. */
  categoryOf: (tx: Transaction) => string;
  onCreateCategory: (name: string) => void;
  onCreateRule: (keyword: string, category: string) => void;
  onDeleteRule: (keyword: string) => void;
  onClose: () => void;
}

const MAX_SHOWN = 25;

/**
 * Refinement tool: search for a keyword and assign a category to every
 * matching transaction — income or expense. The resulting keyword rule
 * outranks grouped categories and is applied to future imports automatically.
 */
export default function RefineCategories({
  transactions,
  keywordRules,
  customCategories,
  categoryOf,
  onCreateCategory,
  onCreateRule,
  onDeleteRule,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, ...customCategories]) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }, [customCategories]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (needle.length < 2) return [];
    return transactions
      .filter((t) => t.description.toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, needle]);

  // Signed total: income and expenses in the same match set net out correctly.
  const total = matches.reduce((a, t) => a + t.amount, 0);

  const sortedRules = useMemo(
    () => [...keywordRules].sort((a, b) => b.createdAt - a.createdAt),
    [keywordRules],
  );

  const countFor = (keyword: string) =>
    transactions.filter((t) => t.description.toLowerCase().includes(keyword)).length;

  const apply = () => {
    if (!needle || !category) return;
    onCreateRule(needle, category);
    setCategory('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="wiz-head">
          <div>
            <h2>Refine categories</h2>
            <p className="muted">
              Search a keyword, then categorize every match. Keyword rules take priority over grouped
              categories, newer rules win over older ones, and they apply to future imports automatically.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="refine-search">
          <input
            autoFocus
            value={query}
            placeholder="Search descriptions — e.g. amazon, uber, careem…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {needle.length >= 2 && (
          <div className="refine-result">
            <div className="refine-result-head">
              <strong>
                {matches.length} matching transaction{matches.length === 1 ? '' : 's'}
              </strong>
              {matches.length > 0 && (
                <span className="muted">{money(total, { sign: true })} net</span>
              )}
            </div>

            {matches.length > 0 && (
              <>
                <div className="refine-assign">
                  <span className="muted">Set all to</span>
                  <CategoryPicker
                    value={category}
                    onChange={setCategory}
                    options={options}
                    onCreate={onCreateCategory}
                    keepValue=""
                    keepLabel="Choose category…"
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!category}
                    onClick={apply}
                  >
                    Apply to {matches.length}
                  </button>
                </div>

                <div className="wiz-list">
                  {matches.slice(0, MAX_SHOWN).map((t) => (
                    <div key={t.id} className="wiz-row wiz-row-leftover">
                      <span className="wiz-date">{t.date}</span>
                      <span className="wiz-desc" title={t.description}>
                        {t.description || '—'}
                      </span>
                      <span className={`wiz-amt ${t.amount >= 0 ? 'pos' : 'neg'}`}>
                        {money(t.amount, { sign: true })}
                      </span>
                      <span className="refine-current">
                        <span className="catdot" style={{ background: categoryColor(categoryOf(t)) }} />
                        {categoryOf(t)}
                      </span>
                    </div>
                  ))}
                  {matches.length > MAX_SHOWN && (
                    <div className="muted refine-more">+{matches.length - MAX_SHOWN} more</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {sortedRules.length > 0 && (
          <div className="refine-rules">
            <h3>Keyword rules · priority order</h3>
            {sortedRules.map((r, i) => (
              <div key={r.keyword} className="refine-rule">
                <span className="refine-rule-pri">{i + 1}</span>
                <span className="refine-rule-kw">“{r.keyword}”</span>
                <span className="refine-rule-arrow">→</span>
                <span className="refine-rule-cat">
                  <span className="catdot" style={{ background: categoryColor(r.category) }} />
                  {r.category}
                </span>
                <span className="refine-rule-count muted">{countFor(r.keyword)} match</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onDeleteRule(r.keyword)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
