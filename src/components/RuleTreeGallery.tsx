import { useMemo, useRef, useState } from 'react';
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
  leaf?: TreeNode;
}

interface RuleTree {
  id: string;
  category: string;
  root: TreeNode;
  branches: TreeBranch[];
}

function subLeafFor(
  category: string,
  key: string,
  subByPair: Map<string, { rule: SubRule; scope: string }>,
  count?: number,
): TreeNode | undefined {
  const found = subByPair.get(`${category}|${key}`);
  if (!found) return undefined;
  const { rule: sr, scope } = found;
  return { key: sr.id, label: sr.sub, category, count, editKind: 'sub', editKey: sr.id, matchKey: key, scope };
}

/**
 * Builds one small tree per category actually produced by this scope's own
 * rules: root = the category, branches = every one of this scope's own
 * keyword/merchant rules that resolves into it, leaf = that rule's
 * sub-category split (if any). Branch counts reflect real transaction
 * resolution (keyword rules always outrank merchant rules; among keyword
 * rules the newest matching one wins), not just "every transaction whose
 * description contains this text" — a rule fully shadowed by a
 * higher-priority one correctly shows a count of 0.
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

  const subByPair = new Map<string, { rule: SubRule; scope: string }>();
  if (ownScope !== 'global') {
    for (const r of globalSubRules) subByPair.set(`${r.parent}|${r.keyword}`, { rule: r, scope: 'global' });
  }
  for (const r of subRules) subByPair.set(`${r.parent}|${r.keyword}`, { rule: r, scope: ownScope });

  const sigRuleMap = new Map(rules.map((r) => [r.signature, r]));
  const branchCounts = new Map<string, number>();

  for (const id of countCardIds) {
    const snap = snapshotById.get(id);
    if (!snap) continue;
    for (const t of snap.transactions) {
      if (t.amount >= 0) continue;
      const desc = t.description.toLowerCase();
      const kwWinner = sortedKeyword.find((k) => k.keyword && desc.includes(k.keyword));
      if (kwWinner) {
        const key = `kw:${kwWinner.keyword}`;
        branchCounts.set(key, (branchCounts.get(key) ?? 0) + 1);
        continue;
      }
      const sig = signatureOf(t.description);
      const rule = sigRuleMap.get(sig);
      if (rule && !rule.excludedIds.includes(t.id)) {
        const key = `sig:${sig}`;
        branchCounts.set(key, (branchCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const byCategory = new Map<string, TreeBranch[]>();

  for (const r of keywordRules) {
    const count = branchCounts.get(`kw:${r.keyword}`) ?? 0;
    const node: TreeNode = {
      key: `kw-${r.keyword}`,
      label: `“${r.keyword}”`,
      category: r.category,
      count,
      editKind: 'keyword',
      editKey: r.keyword,
      scope: ownScope,
    };
    const list = byCategory.get(r.category) ?? [];
    list.push({ node, leaf: subLeafFor(r.category, r.keyword, subByPair, count) });
    byCategory.set(r.category, list);
  }

  for (const r of rules) {
    const count = branchCounts.get(`sig:${r.signature}`) ?? 0;
    const node: TreeNode = {
      key: `sig-${r.signature}`,
      label: r.sample || r.signature,
      category: r.category,
      count,
      editKind: 'signature',
      editKey: r.signature,
      scope: ownScope,
    };
    const list = byCategory.get(r.category) ?? [];
    list.push({ node, leaf: subLeafFor(r.category, r.signature, subByPair, count) });
    byCategory.set(r.category, list);
  }

  const trees: RuleTree[] = [];
  for (const [category, branches] of byCategory) {
    branches.sort((a, b) => (b.node.count ?? 0) - (a.node.count ?? 0));
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
  return tree.branches.some((b) => hit(b.node.label) || hit(b.leaf?.label));
}

const ROOT_X = 14;
const ROOT_W = 104;
const BRANCH_X = 210;
const LEAF_X = 330;
const ROW_H = 34;
const PAD_Y = 10;
const TREE_CELL_W = 400;

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
      </div>
    );
  }

  return null;
}

function treeHeight(tree: RuleTree): number {
  return Math.max(1, tree.branches.length) * ROW_H + PAD_Y * 2;
}

/** One tree's connecting lines, offset into a shared canvas coordinate
 *  space — meant to sit inside one big <svg> covering every tree at once. */
function TreeLines({ tree, offsetX, offsetY }: { tree: RuleTree; offsetX: number; offsetY: number }) {
  const rootY = offsetY + (tree.branches.length * ROW_H) / 2 + PAD_Y;
  const branchY = (i: number) => offsetY + i * ROW_H + ROW_H / 2 + PAD_Y;
  const rootRightEdge = offsetX + ROOT_X + ROOT_W;
  const branchX = offsetX + BRANCH_X;
  const leafX = offsetX + LEAF_X;
  return (
    <>
      {tree.branches.map((b, i) => (
        <g key={b.node.key}>
          <line x1={rootRightEdge} y1={rootY} x2={branchX - 44} y2={branchY(i)} className="tree-line" />
          {b.leaf && <line x1={branchX + 44} y1={branchY(i)} x2={leafX - 40} y2={branchY(i)} className="tree-line" />}
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
  const branchY = (i: number) => offsetY + i * ROW_H + ROW_H / 2 + PAD_Y;
  const rootY = offsetY + (tree.branches.length * ROW_H) / 2 + PAD_Y;
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
            <div className="tree-pop-anchor" style={{ left: branchX, top: branchY(i) + 20 }}>
              <EditPopover node={b.node} onClose={() => onOpen(null)} {...popoverProps} />
            </div>
          )}

          {b.leaf && (
            <>
              <button
                type="button"
                className="tree-bubble tree-bubble-leaf"
                style={{ left: leafX, top: branchY(i) }}
                title={b.leaf.label}
                onClick={() => onOpen(openKey === b.leaf!.key ? null : b.leaf!.key)}
              >
                <span className="tree-bubble-label">{b.leaf.label}</span>
                {b.leaf.count != null && <span className="tree-bubble-count">{b.leaf.count}</span>}
              </button>
              {openKey === b.leaf.key && (
                <div className="tree-pop-anchor" style={{ left: leafX, top: branchY(i) + 20 }}>
                  <EditPopover node={b.leaf} onClose={() => onOpen(null)} {...popoverProps} />
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}

const COLUMNS = 3;
const CELL_GAP_X = 28;
const CELL_GAP_Y = 24;
const CANVAS_PAD = 16;
const VIEWPORT_H = 320;
const DRAG_THRESHOLD = 4;

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef(false);

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
    const cellW = TREE_CELL_W + CELL_GAP_X;
    const items: { tree: RuleTree; x: number; y: number }[] = [];
    let y = CANVAS_PAD;
    for (let i = 0; i < shown.length; i += COLUMNS) {
      const row = shown.slice(i, i + COLUMNS);
      const rowH = Math.max(...row.map(treeHeight));
      row.forEach((tree, c) => items.push({ tree, x: CANVAS_PAD + c * cellW, y }));
      y += rowH + CELL_GAP_Y;
    }
    const cols = Math.min(COLUMNS, shown.length);
    const width = cols > 0 ? CANVAS_PAD * 2 + cols * cellW - CELL_GAP_X : 0;
    return { items, width, height: y };
  }, [shown]);

  const clampPan = (p: { x: number; y: number }) => {
    const vp = viewportRef.current;
    const vw = vp?.clientWidth ?? 0;
    const vh = vp?.clientHeight ?? VIEWPORT_H;
    const minX = Math.min(0, vw - layout.width);
    const minY = Math.min(0, vh - layout.height);
    return { x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) };
  };

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
          ref={viewportRef}
          style={{ height: Math.min(VIEWPORT_H, Math.max(140, layout.height + 8)) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={onClickCapture}
        >
          <div
            className="tree-canvas-content"
            style={{ width: layout.width, height: layout.height, transform: `translate(${pan.x}px, ${pan.y}px)` }}
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
        </div>
      )}
    </div>
  );
}
