import { useMemo, useState } from 'react';
import type { SubRule, Transaction } from '../types';
import { categoryColor, signatureOf } from '../lib/categorize';
import { UNSORTED, suggestSubGroups, type SubResolver } from '../lib/subcategory';
import { money } from '../lib/format';
import CategoryTreemap, { type TreemapCell } from './CategoryTreemap';

interface Props {
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  sub: SubResolver;
  subRules: SubRule[];
  onAddSubRule: (parent: string, keyword: string, subName: string) => void;
  onDeleteSubRule: (id: string) => void;
}

interface Tagged {
  t: Transaction;
  cat: string;
}

const MERCHANT_LIMIT = 12;

export default function CategoriesPage({
  transactions,
  categoryOf,
  sub,
  subRules,
  onAddSubRule,
  onDeleteSubRule,
}: Props) {
  const expenses = useMemo<Tagged[]>(
    () => transactions.filter((t) => t.amount < 0).map((t) => ({ t, cat: categoryOf(t) })),
    [transactions, categoryOf],
  );

  // --- Treemap drill state ---------------------------------------------------
  const [category, setCategory] = useState<string | null>(null);
  const [leaf, setLeaf] = useState<string | null>(null);

  const categoriesPresent = useMemo(() => {
    const totals = new Map<string, number>();
    for (const x of expenses) totals.set(x.cat, (totals.get(x.cat) ?? 0) + -x.t.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [expenses]);

  const rootCells = useMemo<TreemapCell[]>(() => {
    const totals = new Map<string, number>();
    for (const x of expenses) totals.set(x.cat, (totals.get(x.cat) ?? 0) + -x.t.amount);
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value, color: categoryColor(name) }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const inCategory = useMemo(
    () => (category ? expenses.filter((x) => x.cat === category) : []),
    [expenses, category],
  );

  const isSplit = category ? sub.splitParents.has(category) : false;

  const childCells = useMemo<TreemapCell[]>(() => {
    if (!category) return [];
    const totals = new Map<string, number>();
    if (isSplit) {
      for (const x of inCategory) {
        const s = sub.subOf(x.t, category);
        totals.set(s, (totals.get(s) ?? 0) + -x.t.amount);
      }
      return [...totals.entries()]
        .map(([name, value]) => ({
          name,
          value,
          color: name === UNSORTED ? '#cbd5e1' : categoryColor(`${category}/${name}`),
        }))
        .sort((a, b) => b.value - a.value);
    }
    // Not split → break down by merchant so the tile is still explorable.
    for (const x of inCategory) {
      const key = signatureOf(x.t.description);
      totals.set(key, (totals.get(key) ?? 0) + -x.t.amount);
    }
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, MERCHANT_LIMIT);
    const rest = sorted.slice(MERCHANT_LIMIT).reduce((a, [, v]) => a + v, 0);
    const cells = top.map(([name, value]) => ({
      name,
      value,
      color: categoryColor(`${category}/${name}`),
    }));
    if (rest > 0) cells.push({ name: 'Other', value: rest, color: '#cbd5e1' });
    return cells;
  }, [category, inCategory, isSplit, sub]);

  const leafTxs = useMemo(() => {
    if (!category || !leaf) return [];
    const rows = isSplit
      ? inCategory.filter((x) => sub.subOf(x.t, category) === leaf)
      : inCategory.filter((x) => signatureOf(x.t.description) === leaf);
    return rows.map((x) => x.t).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [category, leaf, inCategory, isSplit, sub]);

  const cells = category ? childCells : rootCells;
  const onSelect = (name: string) => {
    if (!category) {
      setCategory(name);
      setLeaf(null);
    } else {
      setLeaf((cur) => (cur === name ? null : name));
    }
  };

  return (
    <div className="cats-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Category map</h2>
            <p className="muted">
              Sized by spending (all time). Click a category to break it down; split categories drill
              into sub-categories.
            </p>
          </div>
        </div>

        <div className="crumbs">
          <button
            type="button"
            className="crumb"
            onClick={() => {
              setCategory(null);
              setLeaf(null);
            }}
          >
            All categories
          </button>
          {category && (
            <>
              <span className="crumb-sep">▸</span>
              <button type="button" className="crumb" onClick={() => setLeaf(null)}>
                {category}
                {isSplit ? '' : ' · merchants'}
              </button>
            </>
          )}
          {category && leaf && (
            <>
              <span className="crumb-sep">▸</span>
              <span className="crumb crumb-current">{leaf}</span>
            </>
          )}
        </div>

        <CategoryTreemap data={cells} onSelect={onSelect} selected={leaf} />

        {category && leaf && (
          <div className="leaf-list">
            <div className="leaf-list-head">
              <strong>
                {leaf} · {leafTxs.length} transaction{leafTxs.length === 1 ? '' : 's'}
              </strong>
              <span className="muted">
                {money(leafTxs.reduce((a, t) => a + -t.amount, 0))}
              </span>
            </div>
            <div className="table-wrap leaf-table">
              <table className="data-table">
                <tbody>
                  {leafTxs.slice(0, 50).map((t) => (
                    <tr key={t.id}>
                      <td className="tx-date">{t.date}</td>
                      <td className="desc" title={t.description}>
                        {t.description || '—'}
                      </td>
                      <td className="num neg">{money(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <SubcategoryManager
        categoriesPresent={categoriesPresent}
        expenses={expenses}
        sub={sub}
        subRules={subRules}
        onAddSubRule={onAddSubRule}
        onDeleteSubRule={onDeleteSubRule}
        onFocusCategory={(c) => {
          setCategory(c);
          setLeaf(null);
        }}
      />
    </div>
  );
}

// --- Sub-category manager -----------------------------------------------------

function SubcategoryManager({
  categoriesPresent,
  expenses,
  sub,
  subRules,
  onAddSubRule,
  onDeleteSubRule,
  onFocusCategory,
}: {
  categoriesPresent: string[];
  expenses: Tagged[];
  sub: SubResolver;
  subRules: SubRule[];
  onAddSubRule: (parent: string, keyword: string, subName: string) => void;
  onDeleteSubRule: (id: string) => void;
  onFocusCategory: (c: string) => void;
}) {
  const [parent, setParent] = useState('');
  const active = parent || categoriesPresent[0] || '';

  const inParent = useMemo(
    () => expenses.filter((x) => x.cat === active).map((x) => x.t),
    [expenses, active],
  );
  const unsorted = useMemo(
    () => inParent.filter((t) => sub.subOf(t, active) === UNSORTED),
    [inParent, active, sub],
  );
  const suggestions = useMemo(() => suggestSubGroups(unsorted), [unsorted]);
  const parentRules = useMemo(
    () => subRules.filter((r) => r.parent === active).sort((a, b) => b.createdAt - a.createdAt),
    [subRules, active],
  );

  const [names, setNames] = useState<Record<string, string>>({});

  const countFor = (keyword: string) =>
    inParent.filter((t) => t.description.toLowerCase().includes(keyword)).length;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Split a category into sub-categories</h2>
          <p className="muted">
            For look-alike buckets like Transfers — name the groups the app finds. Rules apply to
            future imports too; untagged transactions stay “Unsorted”.
          </p>
        </div>
        <label className="picker">
          <span className="picker-label">Category</span>
          <select
            value={active}
            onChange={(e) => {
              setParent(e.target.value);
              setNames({});
            }}
          >
            {categoriesPresent.map((c) => (
              <option key={c} value={c}>
                {c}
                {sub.splitParents.has(c) ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="sub-stats muted">
        {inParent.length} transactions · {inParent.length - unsorted.length} sorted ·{' '}
        {unsorted.length} unsorted
        {sub.splitParents.has(active) && (
          <button type="button" className="linklike" onClick={() => onFocusCategory(active)}>
            view in map
          </button>
        )}
      </div>

      {parentRules.length > 0 && (
        <div className="sub-rules">
          <h3>Sub-categories</h3>
          {parentRules.map((r) => (
            <div key={r.id} className="sub-rule">
              <span className="catdot" style={{ background: categoryColor(`${active}/${r.sub}`) }} />
              <span className="sub-rule-name">{r.sub}</span>
              <span className="muted">
                “{r.keyword}” · {countFor(r.keyword)} match
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onDeleteSubRule(r.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 className="sub-suggest-head">Suggested groups</h3>
      {suggestions.length === 0 ? (
        <p className="muted">
          {unsorted.length === 0
            ? 'Everything here is sorted. 🎉'
            : 'No repeating groups found in the unsorted transactions.'}
        </p>
      ) : (
        <div className="sub-suggests">
          {suggestions.map((s) => (
            <div key={s.keyword} className="sub-suggest">
              <div className="sub-suggest-info">
                <strong>“{s.keyword}”</strong>
                <span className="muted">
                  {s.count} tx · {money(s.total)}
                </span>
                <span className="sub-samples">{s.samples.join(' · ')}</span>
              </div>
              <div className="sub-suggest-add">
                <input
                  value={names[s.keyword] ?? ''}
                  placeholder="Name this group…"
                  maxLength={28}
                  onChange={(e) => setNames((n) => ({ ...n, [s.keyword]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (names[s.keyword] ?? '').trim()) {
                      onAddSubRule(active, s.keyword, names[s.keyword].trim());
                      setNames((n) => ({ ...n, [s.keyword]: '' }));
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!(names[s.keyword] ?? '').trim()}
                  onClick={() => {
                    onAddSubRule(active, s.keyword, names[s.keyword].trim());
                    setNames((n) => ({ ...n, [s.keyword]: '' }));
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
