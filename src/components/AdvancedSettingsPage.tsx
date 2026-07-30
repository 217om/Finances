import { useEffect, useMemo, useState } from 'react';
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
  onReparentSubRule: (id: string, newParent: string) => void;
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

const BUILTIN_PREVIEW = 8;

interface RuleRowProps {
  priority?: number;
  keyLabel: string;
  titleAttr?: string;
  category: string;
  categoryOptions: string[];
  onCreateCategory: (name: string) => void;
  onCategoryChange: (category: string) => void;
  subValue: string;
  onSubCommit: (value: string) => void;
  count: number;
  onReorderUp?: () => void;
  onReorderDown?: () => void;
  reorderUpDisabled?: boolean;
  reorderDownDisabled?: boolean;
  onRemove: () => void;
}

/** One row of the merged rule list: keyword/merchant → category → optional
 *  sub-category. Handles all three row kinds (keyword rule, merchant rule,
 *  standalone sub-rule) through the same shape so they read as one list. */
function RuleRow({
  priority,
  keyLabel,
  titleAttr,
  category,
  categoryOptions,
  onCreateCategory,
  onCategoryChange,
  subValue,
  onSubCommit,
  count,
  onReorderUp,
  onReorderDown,
  reorderUpDisabled,
  reorderDownDisabled,
  onRemove,
}: RuleRowProps) {
  const [draft, setDraft] = useState(subValue);
  useEffect(() => setDraft(subValue), [subValue]);
  const commit = () => {
    const trimmed = draft ? normalizeCategoryName(draft) : '';
    if (trimmed !== subValue) onSubCommit(trimmed);
  };
  return (
    <div className="rules-row">
      {priority != null && <span className="rules-pri">{priority}</span>}
      <span className="rules-kw" title={titleAttr}>
        {keyLabel}
      </span>
      <span className="rules-arrow">→</span>
      <span className="rules-cat-pick">
        <CategoryPicker value={category} onChange={onCategoryChange} options={categoryOptions} onCreate={onCreateCategory} />
      </span>
      <span className="rules-arrow rules-arrow-sub">→</span>
      <input
        className="rules-sub-input"
        value={draft}
        placeholder="sub-category (optional)"
        maxLength={28}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="rules-count muted">
        {count} {plural(count)}
      </span>
      <span className="rules-actions">
        {onReorderUp && (
          <button
            type="button"
            className="btn btn-ghost btn-sm rules-reorder"
            disabled={reorderUpDisabled}
            title="Higher priority"
            onClick={onReorderUp}
          >
            ▲
          </button>
        )}
        {onReorderDown && (
          <button
            type="button"
            className="btn btn-ghost btn-sm rules-reorder"
            disabled={reorderDownDisabled}
            title="Lower priority"
            onClick={onReorderDown}
          >
            ▼
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
          Remove
        </button>
      </span>
    </div>
  );
}

/**
 * The full categorization decision tree for the active card: keyword rules
 * and merchant rules from the wizard — fundamentally the same thing, a match
 * text mapped to a category — merged into one list grouped by category, each
 * row with an optional second arrow to a sub-category. Built-in reference
 * patterns are the read-only fallback. New rules can be added even with zero
 * matching transactions today, so they're ready for future imports.
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
  onReparentSubRule,
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

  // --- Merged keyword + merchant + standalone sub-rules, grouped by category
  const keywordMatchCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of keywordRules) m.set(r.keyword, matchCount(transactions, r.keyword));
    return m;
  }, [keywordRules, transactions]);

  const signatureMatchCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of transactions) {
      if (t.amount >= 0) continue; // signature rules are expense-only
      const sig = signatureOf(t.description);
      m.set(sig, (m.get(sig) ?? 0) + 1);
    }
    return m;
  }, [transactions]);

  const subMatchCounts = useMemo(() => {
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

  // A sub-rule pairs with a top-level rule of the same (category, keyword) —
  // shown as that rule's second arrow instead of its own row.
  const subByPair = useMemo(() => {
    const m = new Map<string, SubRule>();
    for (const r of subRules) m.set(`${r.parent}|${r.keyword}`, r);
    return m;
  }, [subRules]);
  const coveredSubKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of keywordRules) s.add(`${r.category}|${r.keyword}`);
    for (const r of rules) s.add(`${r.category}|${r.signature}`);
    return s;
  }, [keywordRules, rules]);
  const standaloneSubRules = useMemo(
    () => subRules.filter((r) => !coveredSubKeys.has(`${r.parent}|${r.keyword}`)),
    [subRules, coveredSubKeys],
  );

  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const totalRuleCount = keywordRules.length + rules.length;

  const categoryGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q));

    const groups = new Map<string, { keyword: KeywordRule[]; merchant: CategoryRule[]; standalone: SubRule[] }>();
    const ensure = (cat: string) => {
      let g = groups.get(cat);
      if (!g) {
        g = { keyword: [], merchant: [], standalone: [] };
        groups.set(cat, g);
      }
      return g;
    };
    for (const r of keywordRules) if (hit(r.keyword)) ensure(r.category).keyword.push(r);
    for (const r of rules) if (hit(r.signature, r.sample)) ensure(r.category).merchant.push(r);
    for (const r of standaloneSubRules) if (hit(r.keyword, r.sub)) ensure(r.parent).standalone.push(r);

    for (const g of groups.values()) {
      g.keyword.sort((a, b) => b.createdAt - a.createdAt);
      g.merchant.sort((a, b) => a.signature.localeCompare(b.signature));
      g.standalone.sort((a, b) => a.keyword.localeCompare(b.keyword));
    }
    return [...groups.entries()].sort(
      (a, b) => b[1].keyword.length + b[1].merchant.length + b[1].standalone.length - (a[1].keyword.length + a[1].merchant.length + a[1].standalone.length),
    );
  }, [keywordRules, rules, standaloneSubRules, query]);

  // --- Built-in reference, decluttered: collapsed to a preview per category
  const [expandedBuiltIn, setExpandedBuiltIn] = useState<Set<string>>(new Set());
  const toggleBuiltIn = (category: string) => {
    setExpandedBuiltIn((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const commitSub = (parent: string, keyword: string, value: string) => {
    if (value) {
      onCreateSubRule(parent, keyword, value);
    } else if (subByPair.has(`${parent}|${keyword}`)) {
      onDeleteSubRule(`${parent}${keyword}`);
    }
  };

  return (
    <div className="rules-page">
      <p className="muted rules-intro">
        The categorization logic applied to <strong>{cardName}</strong>, grouped by category: keyword
        and merchant rules first (newest wins within a category), then the built-in reference patterns
        as a fallback. Give any rule an optional sub-category for a finer split within that category.
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
            <h2>Category rules</h2>
            <p className="muted">
              Keyword rules you typed and merchant rules from the categorization wizard — both are
              "if description contains X" rules, just grouped here by the category they target.
            </p>
          </div>
          <span className="badge">{totalRuleCount}</span>
        </div>
        {totalRuleCount === 0 && standaloneSubRules.length === 0 ? (
          <p className="muted rules-empty">No rules yet — add one above, or run the categorization wizard from the Dashboard.</p>
        ) : (
          <input
            className="rules-search"
            value={query}
            placeholder="Search rules…"
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {(totalRuleCount > 0 || standaloneSubRules.length > 0) && categoryGroups.length === 0 && (
          <p className="muted rules-empty">No rules match “{query}”.</p>
        )}
        {categoryGroups.length > 0 && (
          <div className="rules-groups">
            {categoryGroups.map(([cat, g]) => (
              <details key={cat} open={searching || undefined}>
                <summary>
                  <span className="catdot" style={{ background: categoryColor(cat) }} />
                  {cat}
                  <span className="muted rules-group-count">{g.keyword.length + g.merchant.length + g.standalone.length}</span>
                </summary>
                <div className="rules-list">
                  {g.keyword.map((r, i) => {
                    const subValue = subByPair.get(`${cat}|${r.keyword}`)?.sub ?? '';
                    return (
                      <RuleRow
                        key={`kw-${r.keyword}`}
                        priority={i + 1}
                        keyLabel={`contains “${r.keyword}”`}
                        category={r.category}
                        categoryOptions={categoryOptions}
                        onCreateCategory={onCreateCategory}
                        onCategoryChange={(newCat) => onUpdateKeywordRuleCategory(r.keyword, newCat)}
                        subValue={subValue}
                        onSubCommit={(v) => commitSub(cat, r.keyword, v)}
                        count={keywordMatchCounts.get(r.keyword) ?? 0}
                        onReorderUp={() => onReorderKeywordRule(r.keyword, 'up')}
                        onReorderDown={() => onReorderKeywordRule(r.keyword, 'down')}
                        reorderUpDisabled={i === 0}
                        reorderDownDisabled={i === g.keyword.length - 1}
                        onRemove={() => onDeleteKeywordRule(r.keyword)}
                      />
                    );
                  })}
                  {g.merchant.map((r) => {
                    const subValue = subByPair.get(`${cat}|${r.signature}`)?.sub ?? '';
                    return (
                      <RuleRow
                        key={`mr-${r.signature}`}
                        keyLabel={r.signature}
                        titleAttr={r.sample}
                        category={r.category}
                        categoryOptions={categoryOptions}
                        onCreateCategory={onCreateCategory}
                        onCategoryChange={(newCat) => onUpdateSignatureRuleCategory(r.signature, newCat)}
                        subValue={subValue}
                        onSubCommit={(v) => commitSub(cat, r.signature, v)}
                        count={signatureMatchCounts.get(r.signature) ?? 0}
                        onRemove={() => onDeleteSignatureRule(r.signature)}
                      />
                    );
                  })}
                  {g.standalone.map((r, i) => (
                    <RuleRow
                      key={`sr-${r.id}`}
                      priority={i + 1}
                      keyLabel={`contains “${r.keyword}”`}
                      category={r.parent}
                      categoryOptions={categoryOptions}
                      onCreateCategory={onCreateCategory}
                      onCategoryChange={(newCat) => onReparentSubRule(r.id, newCat)}
                      subValue={r.sub}
                      onSubCommit={(v) => (v ? onCreateSubRule(r.parent, r.keyword, v) : onDeleteSubRule(r.id))}
                      count={subMatchCounts.get(r.id) ?? 0}
                      onReorderUp={() => onReorderSubRule(r.id, 'up')}
                      onReorderDown={() => onReorderSubRule(r.id, 'down')}
                      reorderUpDisabled={i === 0}
                      reorderDownDisabled={i === g.standalone.length - 1}
                      onRemove={() => onDeleteSubRule(r.id)}
                    />
                  ))}
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
            Always applied as the last resort, when nothing above matches. Add a rule above to override
            any of these for a specific transaction.
          </p>
          <div className="rules-builtin">
            {BUILT_IN_RULES.map((r) => {
              const isOpen = expandedBuiltIn.has(r.category);
              const shown = isOpen ? r.keywords : r.keywords.slice(0, BUILTIN_PREVIEW);
              const hiddenCount = r.keywords.length - shown.length;
              return (
                <div key={r.category} className="rules-builtin-cat">
                  <div className="rules-builtin-cat-name">
                    <span className="catdot" style={{ background: categoryColor(r.category) }} />
                    {r.category}
                  </div>
                  <div className="rules-chips">
                    {shown.map((k) => (
                      <span key={k} className="chip">
                        {k}
                      </span>
                    ))}
                    {hiddenCount > 0 && (
                      <button type="button" className="chip chip-more" onClick={() => toggleBuiltIn(r.category)}>
                        +{hiddenCount} more
                      </button>
                    )}
                    {isOpen && r.keywords.length > BUILTIN_PREVIEW && (
                      <button type="button" className="chip chip-more" onClick={() => toggleBuiltIn(r.category)}>
                        Show less
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </section>
    </div>
  );
}
