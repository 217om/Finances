import { useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryRule, KeywordRule, SubRule } from '../types';
import type { CardSnapshot } from '../lib/combine';
import { categoryColor, normalizeCategoryName, signatureOf } from '../lib/categorize';
import CategoryPicker from './CategoryPicker';

interface TreeNode {
  key: string;
  label: string;
  category?: string;
  count?: number;
  editKind?: 'keyword' | 'signature' | 'sub';
  editKey?: string;
  /** Which scope this node's underlying rule actually lives in — a
   *  sub-category leaf can be a global sub-rule even inside a card's own
   *  tree, so edits/deletes must be routed there, not hardcoded to whichever
   *  scope this gallery instance is showing. */
  scope: string;
  /** For a sub-category leaf: the keyword/signature text its rule is
   *  attached to (distinct from editKey, which is the sub-rule's own id) —
   *  needed to rename it (onSetSub) or delete it (onDeleteSub's info). */
  matchKey?: string;
}

interface TreeBranch {
  node: TreeNode;
  /** This branch's sub-category splits — a sub-rule isn't tied to any one
   *  rule (it matches an independent substring within a category, same as
   *  `subcategory.ts`'s subOf), so a branch can have zero, one, or several,
   *  depending on which of its own matched transactions further match a
   *  sub-rule's keyword. */
  leaves: TreeNode[];
}

interface RuleTree {
  id: string;
  category: string;
  root: TreeNode;
  branches: TreeBranch[];
}

interface BranchAgg {
  count: number;
  subCounts: Map<string, number>;
}

function emptyAgg(): BranchAgg {
  return { count: 0, subCounts: new Map() };
}

/**
 * Builds one small tree per category actually produced by this scope's own
 * rules: root = the category, branches = every one of this scope's own
 * keyword/merchant rules that resolves into it, leaves = sub-category splits
 * within that branch's own matched transactions. Counts reflect real
 * transaction resolution — keyword rules always outrank merchant rules,
 * among keyword rules the newest matching one wins, and a sub-category is
 * whichever sub-rule for that category matches first (newest first), exactly
 * mirroring `makeResolver`/`makeSubResolver` — so a rule fully shadowed by a
 * higher-priority one, or a sub-rule that never actually matches any of a
 * branch's transactions, correctly stays at 0 or absent rather than guessing.
 */
function buildRuleTrees(
  ownScope: string,
  rules: CategoryRule[],
  keywordRules: KeywordRule[],
  effectiveKeywordRules: KeywordRule[],
  subRules: SubRule[],
  globalSubRules: SubRule[],
  countCardIds: string[],
  snapshotById: Map<string, CardSnapshot>,
): RuleTree[] {
  if (rules.length === 0 && keywordRules.length === 0) return [];

  const sortedKeyword = [...effectiveKeywordRules].sort((a, b) => b.createdAt - a.createdAt);

  // This scope's own sub-rule shadows a global one with the exact same
  // (parent, keyword) pair; grouped by category and sorted newest-first so
  // the first match wins, same as makeSubResolver.
  const subByKey = new Map<string, { rule: SubRule; scope: string }>();
  if (ownScope !== 'global') {
    for (const r of globalSubRules) subByKey.set(`${r.parent}|${r.keyword}`, { rule: r, scope: 'global' });
  }
  for (const r of subRules) subByKey.set(`${r.parent}|${r.keyword}`, { rule: r, scope: ownScope });

  const subsByCategory = new Map<string, { rule: SubRule; scope: string }[]>();
  const subById = new Map<string, { rule: SubRule; scope: string }>();
  for (const entry of subByKey.values()) {
    const list = subsByCategory.get(entry.rule.parent) ?? [];
    list.push(entry);
    subsByCategory.set(entry.rule.parent, list);
    subById.set(entry.rule.id, entry);
  }
  for (const list of subsByCategory.values()) list.sort((a, b) => b.rule.createdAt - a.rule.createdAt);

  const sigRuleMap = new Map(rules.map((r) => [r.signature, r]));
  const branchAgg = new Map<string, BranchAgg>();
  const aggFor = (key: string) => {
    let a = branchAgg.get(key);
    if (!a) {
      a = emptyAgg();
      branchAgg.set(key, a);
    }
    return a;
  };

  for (const id of countCardIds) {
    const snap = snapshotById.get(id);
    if (!snap) continue;
    for (const t of snap.transactions) {
      if (t.amount >= 0) continue;
      const desc = t.description.toLowerCase();
      let branchKey: string | undefined;
      let category: string | undefined;
      const kwWinner = sortedKeyword.find((k) => k.keyword && desc.includes(k.keyword));
      if (kwWinner) {
        branchKey = `kw:${kwWinner.keyword}`;
        category = kwWinner.category;
      } else {
        const sig = signatureOf(t.description);
        const rule = sigRuleMap.get(sig);
        if (rule && !rule.excludedIds.includes(t.id)) {
          branchKey = `sig:${sig}`;
          category = rule.category;
        }
      }
      if (!branchKey || !category) continue;
      const agg = aggFor(branchKey);
      agg.count++;
      const subs = subsByCategory.get(category);
      const subWinner = subs?.find((s) => s.rule.keyword && desc.includes(s.rule.keyword));
      if (subWinner) agg.subCounts.set(subWinner.rule.id, (agg.subCounts.get(subWinner.rule.id) ?? 0) + 1);
    }
  }

  const leavesFor = (agg: BranchAgg): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const [subId, count] of agg.subCounts) {
      const entry = subById.get(subId);
      if (!entry) continue;
      const { rule: sr, scope } = entry;
      out.push({ key: sr.id, label: sr.sub, category: sr.parent, count, editKind: 'sub', editKey: sr.id, matchKey: sr.keyword, scope });
    }
    return out;
  };

  const byCategory = new Map<string, TreeBranch[]>();

  for (const r of keywordRules) {
    const agg = branchAgg.get(`kw:${r.keyword}`) ?? emptyAgg();
    const node: TreeNode = {
      key: `kw-${r.keyword}`,
      label: `“${r.keyword}”`,
      category: r.category,
      count: agg.count,
      editKind: 'keyword',
      editKey: r.keyword,
      scope: ownScope,
    };
    const list = byCategory.get(r.category) ?? [];
    list.push({ node, leaves: leavesFor(agg) });
    byCategory.set(r.category, list);
  }

  for (const r of rules) {
    const agg = branchAgg.get(`sig:${r.signature}`) ?? emptyAgg();
    const node: TreeNode = {
      key: `sig-${r.signature}`,
      label: r.sample || r.signature,
      category: r.category,
      count: agg.count,
      editKind: 'signature',
      editKey: r.signature,
      scope: ownScope,
    };
    const list = byCategory.get(r.category) ?? [];
    list.push({ node, leaves: leavesFor(agg) });
    byCategory.set(r.category, list);
  }

  const trees: RuleTree[] = [];
  for (const [category, branches] of byCategory) {
    branches.sort((a, b) => (b.node.count ?? 0) - (a.node.count ?? 0));

    // A sub-rule with no matching transactions yet still gets a visible
    // (0-count) leaf — same "ready for future imports" treatment a
    // brand-new top-level rule already gets — anchored to the top branch
    // since a sub-rule isn't actually tied to any specific one.
    const claimedSubIds = new Set(branches.flatMap((b) => b.leaves.map((l) => l.editKey)));
    const unclaimed = (subsByCategory.get(category) ?? []).filter((entry) => !claimedSubIds.has(entry.rule.id));
    if (unclaimed.length > 0 && branches.length > 0) {
      for (const { rule: sr, scope } of unclaimed) {
        branches[0].leaves.push({
          key: sr.id,
          label: sr.sub,
          category,
          count: 0,
          editKind: 'sub',
          editKey: sr.id,
          matchKey: sr.keyword,
          scope,
        });
      }
    }

    const total = branches.reduce((sum, b) => sum + (b.node.count ?? 0), 0);
    trees.push({
      id: `cat-${category}`,
      category,
      root: { key: category, label: category, category, count: total, scope: ownScope },
      branches,
    });
  }
  trees.sort((a, b) => (b.root.count ?? 0) - (a.root.count ?? 0) || a.category.localeCompare(b.category));

  return trees;
}

function treeMatches(tree: RuleTree, needle: string): boolean {
  if (!needle) return true;
  const hit = (s: string | undefined) => !!s && s.toLowerCase().includes(needle);
  if (hit(tree.category)) return true;
  return tree.branches.some((b) => hit(b.node.label) || b.leaves.some((l) => hit(l.label)));
}

const ROOT_X = 14;
const ROOT_W = 104;
const BRANCH_X = 210;
const LEAF_X = 330;
const ROW_H = 48;
const PAD_Y = 14;
const TREE_CELL_W = 400;

/** How many ROW_H-tall rows a branch occupies — at least 1, or one per leaf
 *  when it has several sub-category splits stacked under it. */
function branchSpan(b: TreeBranch): number {
  return Math.max(1, b.leaves.length);
}

/** Cumulative row offset (in ROW_H units) each branch starts at, plus the
 *  tree's total row count — shared by TreeLines and TreeBubbles so their
 *  geometry always agrees. */
function rowLayout(tree: RuleTree): { starts: number[]; totalRows: number } {
  const starts: number[] = [];
  let acc = 0;
  for (const b of tree.branches) {
    starts.push(acc);
    acc += branchSpan(b);
  }
  return { starts, totalRows: Math.max(1, acc) };
}

interface EditPopoverProps {
  node: TreeNode;
  categoryOptions: string[];
  onCreateCategory: (scope: string, name: string) => void;
  onUpdateKeywordRuleCategory: (scope: string, keyword: string, category: string) => void;
  onDeleteKeywordRule: (scope: string, keyword: string, category: string) => void;
  onUpdateSignatureRuleCategory: (scope: string, signature: string, category: string) => void;
  onDeleteSignatureRule: (scope: string, signature: string, category: string) => void;
  onSetSub: (scope: string, parent: string, key: string, sub: string) => void;
  onDeleteSub: (scope: string, id: string, info: { parent: string; sub: string; keyword: string }) => void;
  onClose: () => void;
}

/** A small inline form inside a branch's popover for creating a new
 *  sub-category split directly from the chart — same effect as the classic
 *  "Keyword → sub-category" form below, just pre-scoped to this branch's own
 *  category. Newly created sub-rules show up as leaves (and in the table
 *  below) on the next render once they have a real matching transaction. */
function SubAddForm({ node, onSetSub }: { node: TreeNode; onSetSub: EditPopoverProps['onSetSub'] }) {
  const [kw, setKw] = useState('');
  const [name, setName] = useState('');

  const commit = () => {
    const key = kw.trim().toLowerCase();
    const sub = normalizeCategoryName(name);
    if (key.length < 2 || !sub || !node.category) return;
    onSetSub(node.scope, node.category, key, sub);
    setKw('');
    setName('');
  };

  return (
    <div className="tree-pop-subadd">
      <span className="tree-pop-subadd-label">Split into a sub-category</span>
      <input
        className="rules-sub-input"
        placeholder="if description also has…"
        value={kw}
        maxLength={40}
        onChange={(e) => setKw(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <input
        className="rules-sub-input"
        placeholder="sub-category name"
        value={name}
        maxLength={28}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={kw.trim().length < 2 || !name.trim()}
        onClick={commit}
      >
        + Add split
      </button>
    </div>
  );
}

/** The popover a branch or leaf bubble opens — lets you change its category
 *  (branch) or rename it (leaf), or remove it, without leaving the gallery. */
function EditPopover({
  node,
  categoryOptions,
  onCreateCategory,
  onUpdateKeywordRuleCategory,
  onDeleteKeywordRule,
  onUpdateSignatureRuleCategory,
  onDeleteSignatureRule,
  onSetSub,
  onDeleteSub,
  onClose,
}: EditPopoverProps) {
  const [subDraft, setSubDraft] = useState(node.editKind === 'sub' ? node.label : '');

  if (node.editKind === 'sub' && node.editKey && node.matchKey) {
    const commit = () => {
      const trimmed = normalizeCategoryName(subDraft);
      if (trimmed && trimmed !== node.label && node.category) onSetSub(node.scope, node.category, node.matchKey!, trimmed);
      onClose();
    };
    return (
      <div className="tree-pop" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="rules-sub-input"
          value={subDraft}
          maxLength={28}
          onChange={(e) => setSubDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <div className="tree-pop-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={commit}>
            Save
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onDeleteSub(node.scope, node.key, { parent: node.category ?? '', sub: node.label, keyword: node.matchKey! });
              onClose();
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  if (node.editKind === 'keyword' && node.editKey) {
    return (
      <div className="tree-pop" onClick={(e) => e.stopPropagation()}>
        <CategoryPicker
          value={node.category ?? ''}
          onChange={(cat) => {
            onUpdateKeywordRuleCategory(node.scope, node.editKey!, cat);
            onClose();
          }}
          options={categoryOptions}
          onCreate={(name) => onCreateCategory(node.scope, name)}
        />
        <div className="tree-pop-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onDeleteKeywordRule(node.scope, node.editKey!, node.category ?? '');
              onClose();
            }}
          >
            Remove rule
          </button>
        </div>
        <SubAddForm node={node} onSetSub={onSetSub} />
      </div>
    );
  }

  if (node.editKind === 'signature' && node.editKey) {
    return (
      <div className="tree-pop" onClick={(e) => e.stopPropagation()}>
        <CategoryPicker
          value={node.category ?? ''}
          onChange={(cat) => {
            onUpdateSignatureRuleCategory(node.scope, node.editKey!, cat);
            onClose();
          }}
          options={categoryOptions}
          onCreate={(name) => onCreateCategory(node.scope, name)}
        />
        <div className="tree-pop-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onDeleteSignatureRule(node.scope, node.editKey!, node.category ?? '');
              onClose();
            }}
          >
            Remove rule
          </button>
        </div>
        <SubAddForm node={node} onSetSub={onSetSub} />
      </div>
    );
  }

  return null;
}

function treeHeight(tree: RuleTree): number {
  return rowLayout(tree).totalRows * ROW_H + PAD_Y * 2;
}

/** One tree's connecting lines, offset into a shared canvas coordinate
 *  space — meant to sit inside one big <svg> covering every tree at once. */
function TreeLines({ tree, offsetX, offsetY }: { tree: RuleTree; offsetX: number; offsetY: number }) {
  const { starts, totalRows } = rowLayout(tree);
  const rootY = offsetY + (totalRows * ROW_H) / 2 + PAD_Y;
  const branchY = (i: number) => offsetY + (starts[i] + branchSpan(tree.branches[i]) / 2) * ROW_H + PAD_Y;
  const leafY = (i: number, j: number) => offsetY + (starts[i] + j + 0.5) * ROW_H + PAD_Y;
  const rootRightEdge = offsetX + ROOT_X + ROOT_W;
  const branchX = offsetX + BRANCH_X;
  const leafX = offsetX + LEAF_X;
  return (
    <>
      {tree.branches.map((b, i) => (
        <g key={b.node.key}>
          <line x1={rootRightEdge} y1={rootY} x2={branchX - 44} y2={branchY(i)} className="tree-line" />
          {b.leaves.map((leaf, j) => (
            <line key={leaf.key} x1={branchX + 44} y1={branchY(i)} x2={leafX - 40} y2={leafY(i, j)} className="tree-line" />
          ))}
        </g>
      ))}
    </>
  );
}

interface TreeBubblesProps {
  tree: RuleTree;
  offsetX: number;
  offsetY: number;
  openKey: string | null;
  onOpen: (key: string | null) => void;
  popoverProps: Omit<EditPopoverProps, 'node' | 'onClose'>;
}

/** One tree's root/branch/leaf bubbles, offset into the same shared canvas
 *  coordinate space as TreeLines. */
function TreeBubbles({ tree, offsetX, offsetY, openKey, onOpen, popoverProps }: TreeBubblesProps) {
  const { starts, totalRows } = rowLayout(tree);
  const branchY = (i: number) => offsetY + (starts[i] + branchSpan(tree.branches[i]) / 2) * ROW_H + PAD_Y;
  const leafY = (i: number, j: number) => offsetY + (starts[i] + j + 0.5) * ROW_H + PAD_Y;
  const rootY = offsetY + (totalRows * ROW_H) / 2 + PAD_Y;
  const rootX = offsetX + ROOT_X;
  const branchX = offsetX + BRANCH_X;
  const leafX = offsetX + LEAF_X;

  return (
    <>
      <div
        className="tree-bubble tree-bubble-root"
        style={{ left: rootX, top: rootY, width: ROOT_W, background: categoryColor(tree.category) }}
        title={tree.category}
      >
        <span className="tree-bubble-label">{tree.category}</span>
        {tree.root.count != null && <span className="tree-bubble-count">{tree.root.count}</span>}
      </div>

      {tree.branches.map((b, i) => (
        <div key={b.node.key}>
          <button
            type="button"
            className="tree-bubble tree-bubble-cat"
            style={{ left: branchX, top: branchY(i) }}
            title={b.node.label}
            onClick={() => onOpen(openKey === b.node.key ? null : b.node.key)}
          >
            <span className="tree-bubble-label">{b.node.label}</span>
            {b.node.count != null && <span className="tree-bubble-count">{b.node.count}</span>}
          </button>
          {openKey === b.node.key && (
            <div className="tree-pop-anchor" style={{ left: branchX, top: branchY(i) + 24 }}>
              <EditPopover node={b.node} onClose={() => onOpen(null)} {...popoverProps} />
            </div>
          )}

          {b.leaves.map((leaf, j) => (
            <div key={leaf.key}>
              <button
                type="button"
                className="tree-bubble tree-bubble-leaf"
                style={{ left: leafX, top: leafY(i, j) }}
                title={leaf.label}
                onClick={() => onOpen(openKey === leaf.key ? null : leaf.key)}
              >
                <span className="tree-bubble-label">{leaf.label}</span>
                {leaf.count != null && <span className="tree-bubble-count">{leaf.count}</span>}
              </button>
              {openKey === leaf.key && (
                <div className="tree-pop-anchor" style={{ left: leafX, top: leafY(i, j) + 24 }}>
                  <EditPopover node={leaf} onClose={() => onOpen(null)} {...popoverProps} />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

const CELL_GAP_Y = 24;
const CANVAS_PAD = 16;
const VIEWPORT_H = 320;
const DRAG_THRESHOLD = 4;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_BUTTON_FACTOR = 1.25;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

interface DragState {
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  dragging: boolean;
}

interface Props {
  /** The scope this gallery's OWN rules belong to — 'global', or a card id. */
  ownScope: string;
  rules: CategoryRule[];
  keywordRules: KeywordRule[];
  /** Same array as keywordRules when ownScope is 'global'; otherwise the
   *  global set merged on top — needed so a card's own branch counts are
   *  reduced correctly when a higher-priority global keyword rule actually
   *  wins some of its transactions. */
  effectiveKeywordRules: KeywordRule[];
  subRules: SubRule[];
  globalSubRules: SubRule[];
  countCardIds: string[];
  snapshotById: Map<string, CardSnapshot>;
  query: string;
  categoryOptions: string[];
  onCreateCategory: (scope: string, name: string) => void;
  onUpdateKeywordRuleCategory: (scope: string, keyword: string, category: string) => void;
  onDeleteKeywordRule: (scope: string, keyword: string, category: string) => void;
  onUpdateSignatureRuleCategory: (scope: string, signature: string, category: string) => void;
  onDeleteSignatureRule: (scope: string, signature: string, category: string) => void;
  onSetSub: (scope: string, parent: string, key: string, sub: string) => void;
  onDeleteSub: (scope: string, id: string, info: { parent: string; sub: string; keyword: string }) => void;
}

/**
 * Always-visible, single pannable widget holding every tree at once — one
 * per category this scope's own rules actually produce. Root = the
 * category, branches = every rule (keyword or merchant) that resolves into
 * it, leaf = that rule's sub-category split, if any. Trees sit on a shared
 * virtual canvas usually larger than the visible viewport; drag anywhere in
 * the widget to pan around it. Click a branch or leaf bubble to change its
 * category or sub-category without hunting through the list below.
 */
export default function RuleTreeGallery({
  ownScope,
  rules,
  keywordRules,
  effectiveKeywordRules,
  subRules,
  globalSubRules,
  countCardIds,
  snapshotById,
  query,
  categoryOptions,
  onCreateCategory,
  onUpdateKeywordRuleCategory,
  onDeleteKeywordRule,
  onUpdateSignatureRuleCategory,
  onDeleteSignatureRule,
  onSetSub,
  onDeleteSub,
}: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(0);
  // A plain ref (for the imperative reads below) isn't enough on its own —
  // the viewport <div> only exists once there's at least one tree to show,
  // so an effect with an empty dependency array would run before it's ever
  // mounted and never retry. Mirroring the node into state via a callback
  // ref makes the ResizeObserver effect re-run whenever the element itself
  // actually mounts or unmounts.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const setViewportRef = (el: HTMLDivElement | null) => {
    viewportRef.current = el;
    setViewportEl(el);
  };
  const dragRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef(false);

  // Tracked so trees can be centered within however wide the widget actually
  // renders, rather than packed left-aligned into a fixed-width grid.
  useEffect(() => {
    if (!viewportEl) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setViewportWidth(w);
    });
    ro.observe(viewportEl);
    return () => ro.disconnect();
  }, [viewportEl]);

  const trees = useMemo(
    () =>
      buildRuleTrees(
        ownScope,
        rules,
        keywordRules,
        effectiveKeywordRules,
        subRules,
        globalSubRules,
        countCardIds,
        snapshotById,
      ),
    [ownScope, rules, keywordRules, effectiveKeywordRules, subRules, globalSubRules, countCardIds, snapshotById],
  );

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => trees.filter((t) => treeMatches(t, needle)), [trees, needle]);

  const layout = useMemo(() => {
    // One tree per row, centered horizontally in however wide the widget
    // currently is (falling back to just fitting one tree before the first
    // resize measurement lands).
    const width = Math.max(viewportWidth, TREE_CELL_W + CANVAS_PAD * 2);
    const treeX = Math.max(CANVAS_PAD, (width - TREE_CELL_W) / 2);
    const items: { tree: RuleTree; x: number; y: number }[] = [];
    let y = CANVAS_PAD;
    for (const tree of shown) {
      items.push({ tree, x: treeX, y });
      y += treeHeight(tree) + CELL_GAP_Y;
    }
    return { items, width, height: y };
  }, [shown, viewportWidth]);

  const clampPan = (p: { x: number; y: number }, z: number = zoom) => {
    const vp = viewportRef.current;
    const vw = vp?.clientWidth ?? 0;
    const vh = vp?.clientHeight ?? VIEWPORT_H;
    const minX = Math.min(0, vw - layout.width * z);
    const minY = Math.min(0, vh - layout.height * z);
    return { x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) };
  };

  /** Zoom to `newZoomRaw`, keeping the content point under (anchorX, anchorY)
   *  — viewport-relative coordinates — fixed in place, so zooming with the
   *  cursor over a bubble keeps that bubble under the cursor. */
  const zoomTo = (newZoomRaw: number, anchorX: number, anchorY: number) => {
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoomRaw));
    const cx = (anchorX - pan.x) / zoom;
    const cy = (anchorY - pan.y) / zoom;
    setZoom(newZoom);
    setPan(clampPan({ x: anchorX - cx * newZoom, y: anchorY - cy * newZoom }, newZoom));
  };

  const zoomByFactor = (factor: number) => {
    const vp = viewportRef.current;
    zoomTo(zoom * factor, (vp?.clientWidth ?? 0) / 2, (vp?.clientHeight ?? 0) / 2);
  };

  // Attached natively (not via the JSX onWheel prop) so preventDefault
  // actually works — React registers wheel listeners as passive by default,
  // which silently ignores preventDefault and lets the browser's own
  // page-zoom handle ctrl+scroll instead of us.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      zoomTo(zoom * factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoom, pan, layout.width, layout.height]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.dragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      d.dragging = true;
      // Capture only once a real drag is confirmed — capturing on every
      // pointerdown (even a plain click) can suppress the click event that
      // would otherwise fire on the bubble underneath, since click synthesis
      // compares the pointerdown/pointerup targets and capture redirects the
      // up-target to this element.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.dragging) setPan(clampPan({ x: d.startPanX + dx, y: d.startPanY + dy }));
  };
  const onPointerUp = () => {
    if (dragRef.current?.dragging) justDraggedRef.current = true;
    dragRef.current = null;
  };
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (justDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      justDraggedRef.current = false;
    }
  };

  if (trees.length === 0) return null;

  const popoverProps = {
    categoryOptions,
    onCreateCategory,
    onUpdateKeywordRuleCategory,
    onDeleteKeywordRule,
    onUpdateSignatureRuleCategory,
    onDeleteSignatureRule,
    onSetSub,
    onDeleteSub,
  };

  return (
    <div className="tree-gallery">
      {shown.length === 0 ? (
        <p className="muted rules-empty">No rule trees match “{query}”.</p>
      ) : (
        <div
          className="tree-canvas-viewport"
          ref={setViewportRef}
          style={{ height: Math.min(VIEWPORT_H, Math.max(140, layout.height + 8)) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={onClickCapture}
        >
          <div
            className="tree-canvas-content"
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <svg className="tree-lines" width={layout.width} height={layout.height}>
              {layout.items.map(({ tree, x, y }) => (
                <TreeLines key={tree.id} tree={tree} offsetX={x} offsetY={y} />
              ))}
            </svg>
            {layout.items.map(({ tree, x, y }) => (
              <TreeBubbles
                key={tree.id}
                tree={tree}
                offsetX={x}
                offsetY={y}
                openKey={openKey}
                onOpen={setOpenKey}
                popoverProps={popoverProps}
              />
            ))}
          </div>
          <div
            className="tree-zoom-controls"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" aria-label="Zoom out" onClick={() => zoomByFactor(1 / ZOOM_BUTTON_FACTOR)}>
              −
            </button>
            <button
              type="button"
              className="tree-zoom-reset"
              title="Reset zoom"
              onClick={() => {
                const vp = viewportRef.current;
                zoomTo(1, (vp?.clientWidth ?? 0) / 2, (vp?.clientHeight ?? 0) / 2);
              }}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => zoomByFactor(ZOOM_BUTTON_FACTOR)}>
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
