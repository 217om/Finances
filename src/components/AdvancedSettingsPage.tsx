import { useMemo, useState } from 'react';
import type { CategoryRule, KeywordRule, SubRule, Transaction } from '../types';
import {
  BUILT_IN_RULES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  categoryColor,
  normalizeCategoryName,
  signatureOf,
} from '../lib/categorize';
import CategoryPicker from './CategoryPicker';

interface Props {
  cardName: string;
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  customCategories: string[];
  rules: CategoryRule[];
  keywordRules: KeywordRule[];
  subRules: SubRule[];
  onCreateCategory: (name: string) => void;
  onCreateKeywordRule: (keyword: string, category: string) => void;
  onUpdateKeywordRuleCategory: (keyword: string, category: string) => void;
  onDeleteKeywordRule: (keyword: string) => void;
  onReorderKeywordRule: (keyword: string, direction: 'up' | 'down') => void;
  onUpdateSignatureRuleCategory: (signature: string, category: string) => void;
  onDeleteSignatureRule: (signature: string) => void;
  onCreateSubRule: (parent: string, keyword: string, sub: string) => void;
  onDeleteSubRule: (id: string) => void;
  onReorderSubRule: (id: string, direction: 'up' | 'down') => void;
}

function matchCount(transactions: Transaction[], needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (const t of transactions) if (t.description.toLowerCase().includes(needle)) n++;
  return n;
}

function plural(n: number): string {
  return n === 1 ? 'transaction' : 'transactions';
}

/**
 * The full categorization decision tree for the active card, in the same
 * precedence order the resolver actually applies it: keyword rules first
 * (newest wins), then merchant (signature) rules from the wizard, then the
 * built-in reference patterns as a fallback — plus the independent
 * sub-category tier layered on top of whichever top-level category wins.
 * Everything here is editable except the built-in reference; new rules can
 * be added even with zero matching transactions today, so they're ready for
 * future imports.
 */
export default function AdvancedSettingsPage({
  cardName,
  transactions,
  categoryOf,
  customCategories,
  rules,
  keywordRules,
  subRules,
  onCreateCategory,
  onCreateKeywordRule,
  onUpdateKeywordRuleCategory,
  onDeleteKeywordRule,
  onReorderKeywordRule,
  onUpdateSignatureRuleCategory,
  onDeleteSignatureRule,
  onCreateSubRule,
  onDeleteSubRule,
  onReorderSubRule,
}: Props) {
  const categoryOptions = useMemo(() => {
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

  // --- Add-rule form -----------------------------------------------------
  const [mode, setMode] = useState<'keyword' | 'sub'>('keyword');
  const [kwText, setKwText] = useState('');
  const [kwCategory, setKwCategory] = useState('');
  const [subParent, setSubParent] = useState('');
  const [subText, setSubText] = useState('');
  const [subName, setSubName] = useState('');

  const kwNeedle = kwText.trim().toLowerCase();
  const kwMatches = kwNeedle.length >= 2 ? matchCount(transactions, kwNeedle) : 0;

  const subNeedle = subText.trim().toLowerCase();
  const subMatches = useMemo(() => {
    if (!subParent || subNeedle.length < 2) return 0;
    let n = 0;
    for (const t of transactions) {
      if (categoryOf(t) === subParent && t.description.toLowerCase().includes(subNeedle)) n++;
    }
    return n;
  }, [transactions, categoryOf, subParent, subNeedle]);

  const subNamesForParent = useMemo(() => {
    if (!subParent) return [];
    const set = new Set<string>();
    for (const r of subRules) if (r.parent === subParent) set.add(r.sub);
    return [...set].sort();
  }, [subRules, subParent]);

  const submitKeyword = () => {
    if (!kwNeedle || !kwCategory) return;
    onCreateKeywordRule(kwNeedle, kwCategory);
    setKwText('');
    setKwCategory('');
  };

  const submitSub = () => {
    const kw = subText.trim().toLowerCase();
    const name = normalizeCategoryName(subName);
    if (!subParent || !kw || !name) return;
    onCreateSubRule(subParent, kw, name);
    setSubText('');
    setSubName('');
  };

  // --- Keyword rules (global priority order, newest first) ---------------
  const sortedKeywordRules = useMemo(
    () => [...keywordRules].sort((a, b) => b.createdAt - a.createdAt),
    [keywordRules],
  );
  const keywordMatchCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of keywordRules) m.set(r.keyword, matchCount(transactions, r.keyword));
    return m;
  }, [keywordRules, transactions]);

  // --- Merchant (signature) rules, grouped by category, searchable -------
  const [merchantQuery, setMerchantQuery] = useState('');
  const signatureMatchCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of transactions) {
      if (t.amount >= 0) continue; // signature rules are expense-only
      const sig = signatureOf(t.description);
      m.set(sig, (m.get(sig) ?? 0) + 1);
    }
    return m;
  }, [transactions]);
  const filteredRules = useMemo(() => {
    const q = merchantQuery.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) => r.signature.includes(q) || r.sample.toLowerCase().includes(q));
  }, [rules, merchantQuery]);
  const rulesByCategory = useMemo(() => {
    const m = new Map<string, CategoryRule[]>();
    for (const r of filteredRules) {
      const list = m.get(r.category);
      if (list) list.push(r);
      else m.set(r.category, [r]);
    }
    for (const list of m.values()) list.sort((a, b) => a.signature.localeCompare(b.signature));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filteredRules]);
  const searching = merchantQuery.trim().length > 0;

  // --- Sub-category rules, grouped by parent ------------------------------
  const subRulesByParent = useMemo(() => {
    const m = new Map<string, SubRule[]>();
    for (const r of subRules) {
      const list = m.get(r.parent);
      if (list) list.push(r);
      else m.set(r.parent, [r]);
    }
    for (const list of m.values()) list.sort((a, b) => b.createdAt - a.createdAt);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [subRules]);
  const subRuleMatchCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of subRules) {
      let n = 0;
      for (const t of transactions) {
        if (categoryOf(t) === r.parent && t.description.toLowerCase().includes(r.keyword)) n++;
      }
      m.set(r.id, n);
    }
    return m;
  }, [subRules, transactions, categoryOf]);

  return (
    <div className="rules-page">
      <p className="muted rules-intro">
        The categorization logic applied to <strong>{cardName}</strong>, in the order it's actually
        checked: keyword rules first (newest wins), then merchant rules from the categorization
        wizard, then the built-in reference patterns as a fallback. Sub-category rules are a separate,
        independent tier layered on top of whichever category wins above.
      </p>

      <section className="panel rules-add">
        <div className="panel-head">
          <div>
            <h2>Add a rule</h2>
            <p className="muted">
              Applies immediately to matching transactions, and automatically to anything you import
              later — even with zero matches today.
            </p>
          </div>
          <div className="seg seg-sm">
            <button type="button" className={mode === 'keyword' ? 'seg-on' : ''} onClick={() => setMode('keyword')}>
              Keyword → category
            </button>
            <button type="button" className={mode === 'sub' ? 'seg-on' : ''} onClick={() => setMode('sub')}>
              Keyword → sub-category
            </button>
          </div>
        </div>

        {mode === 'keyword' ? (
          <div className="rules-form">
            <span className="muted">If description contains</span>
            <input
              value={kwText}
              placeholder="e.g. carrefour"
              maxLength={64}
              onChange={(e) => setKwText(e.target.value)}
            />
            <span className="muted">classify as</span>
            <CategoryPicker
              value={kwCategory}
              onChange={setKwCategory}
              options={categoryOptions}
              onCreate={onCreateCategory}
              keepValue=""
              keepLabel="Choose category…"
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!kwNeedle || !kwCategory}
              onClick={submitKeyword}
            >
              Save rule
            </button>
            {kwNeedle.length >= 2 && (
              <span className="rules-preview muted">
                {kwMatches === 0
                  ? 'No transactions match yet — the rule will still apply to future imports'
                  : `${kwMatches} matching ${plural(kwMatches)} now`}
              </span>
            )}
          </div>
        ) : (
          <div className="rules-form">
            <span className="muted">Within</span>
            <select value={subParent} onChange={(e) => setSubParent(e.target.value)}>
              <option value="">Choose category…</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="muted">if description contains</span>
            <input
              value={subText}
              placeholder="e.g. savings"
              maxLength={64}
              onChange={(e) => setSubText(e.target.value)}
            />
            <span className="muted">sub-category</span>
            <input
              value={subName}
              placeholder="e.g. Savings transfer"
              maxLength={28}
              list="rules-sub-names"
              onChange={(e) => setSubName(e.target.value)}
            />
            <datalist id="rules-sub-names">
              {subNamesForParent.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!subParent || !subText.trim() || !subName.trim()}
              onClick={submitSub}
            >
              Save rule
            </button>
            {subParent && subNeedle.length >= 2 && (
              <span className="rules-preview muted">
                {subMatches === 0
                  ? 'No transactions match yet — the rule will still apply to future imports'
                  : `${subMatches} matching ${plural(subMatches)} now`}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Keyword rules</h2>
            <p className="muted">Highest priority — checked first, newest wins when more than one matches.</p>
          </div>
          <span className="badge">{sortedKeywordRules.length}</span>
        </div>
        {sortedKeywordRules.length === 0 ? (
          <p className="muted rules-empty">No keyword rules yet — add one above.</p>
        ) : (
          <div className="rules-list">
            {sortedKeywordRules.map((r, i) => {
              const count = keywordMatchCounts.get(r.keyword) ?? 0;
              return (
                <div key={r.keyword} className="rules-row">
                  <span className="rules-pri">{i + 1}</span>
                  <span className="rules-kw">contains “{r.keyword}”</span>
                  <span className="rules-arrow">→</span>
                  <span className="rules-cat-pick">
                    <CategoryPicker
                      value={r.category}
                      onChange={(cat) => onUpdateKeywordRuleCategory(r.keyword, cat)}
                      options={categoryOptions}
                      onCreate={onCreateCategory}
                    />
                  </span>
                  <span className="rules-count muted">
                    {count} {plural(count)}
                  </span>
                  <span className="rules-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm rules-reorder"
                      disabled={i === 0}
                      title="Higher priority"
                      onClick={() => onReorderKeywordRule(r.keyword, 'up')}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm rules-reorder"
                      disabled={i === sortedKeywordRules.length - 1}
                      title="Lower priority"
                      onClick={() => onReorderKeywordRule(r.keyword, 'down')}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onDeleteKeywordRule(r.keyword)}
                    >
                      Remove
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Merchant rules</h2>
            <p className="muted">
              From the categorization wizard — one rule per merchant, applied to expenses only.
            </p>
          </div>
          <span className="badge">{rules.length}</span>
        </div>
        {rules.length > 0 && (
          <input
            className="rules-search"
            value={merchantQuery}
            placeholder="Search merchants…"
            onChange={(e) => setMerchantQuery(e.target.value)}
          />
        )}
        {rules.length === 0 ? (
          <p className="muted rules-empty">
            No merchant rules yet — run the categorization wizard from the Dashboard to create some.
          </p>
        ) : rulesByCategory.length === 0 ? (
          <p className="muted rules-empty">No merchants match “{merchantQuery}”.</p>
        ) : (
          <div className="rules-groups">
            {rulesByCategory.map(([cat, list]) => (
              <details key={cat} open={searching || undefined}>
                <summary>
                  <span className="catdot" style={{ background: categoryColor(cat) }} />
                  {cat}
                  <span className="muted rules-group-count">{list.length}</span>
                </summary>
                <div className="rules-list">
                  {list.map((r) => {
                    const count = signatureMatchCounts.get(r.signature) ?? 0;
                    return (
                      <div key={r.signature} className="rules-row">
                        <span className="rules-kw" title={r.sample}>
                          {r.signature}
                        </span>
                        <span className="rules-arrow">→</span>
                        <span className="rules-cat-pick">
                          <CategoryPicker
                            value={r.category}
                            onChange={(newCat) => onUpdateSignatureRuleCategory(r.signature, newCat)}
                            options={categoryOptions}
                            onCreate={onCreateCategory}
                          />
                        </span>
                        <span className="rules-count muted">
                          {count} {plural(count)}
                        </span>
                        <span className="rules-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => onDeleteSignatureRule(r.signature)}
                          >
                            Remove
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <details>
          <summary>
            <strong>Built-in reference patterns</strong>
            <span className="muted rules-group-count">read-only</span>
          </summary>
          <p className="muted">
            Always applied as the last resort, when nothing above matches. Add a keyword or merchant
            rule to override any of these for a specific transaction.
          </p>
          <div className="rules-builtin">
            {BUILT_IN_RULES.map((r) => (
              <div key={r.category} className="rules-builtin-row">
                <span className="rules-cat">
                  <span className="catdot" style={{ background: categoryColor(r.category) }} />
                  {r.category}
                </span>
                <div className="rules-chips">
                  {r.keywords.map((k) => (
                    <span key={k} className="chip">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Sub-category rules</h2>
            <p className="muted">
              A second, independent tier — splits a category further without changing it. Newest wins
              within each category.
            </p>
          </div>
          <span className="badge">{subRules.length}</span>
        </div>
        {subRulesByParent.length === 0 ? (
          <p className="muted rules-empty">No sub-category rules yet — add one above.</p>
        ) : (
          <div className="rules-groups">
            {subRulesByParent.map(([parent, list]) => (
              <details key={parent} open>
                <summary>
                  <span className="catdot" style={{ background: categoryColor(parent) }} />
                  {parent}
                  <span className="muted rules-group-count">{list.length}</span>
                </summary>
                <div className="rules-list">
                  {list.map((r, i) => {
                    const count = subRuleMatchCounts.get(r.id) ?? 0;
                    return (
                      <div key={r.id} className="rules-row">
                        <span className="rules-pri">{i + 1}</span>
                        <span className="rules-kw">contains “{r.keyword}”</span>
                        <span className="rules-arrow">→</span>
                        <span className="rules-cat">{r.sub}</span>
                        <span className="rules-count muted">
                          {count} {plural(count)}
                        </span>
                        <span className="rules-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm rules-reorder"
                            disabled={i === 0}
                            title="Higher priority"
                            onClick={() => onReorderSubRule(r.id, 'up')}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm rules-reorder"
                            disabled={i === list.length - 1}
                            title="Lower priority"
                            onClick={() => onReorderSubRule(r.id, 'down')}
                          >
                            ▼
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDeleteSubRule(r.id)}>
                            Remove
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
