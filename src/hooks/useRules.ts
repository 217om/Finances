// The categorization system: per-card and global rules (signature/keyword/
// sub-category), overrides, custom categories, every other card's full data
// (needed for cross-card rule resolution and "freeze on delete"), and the
// derived resolvers/snapshots almost every tab reads from. This is the
// largest and most interconnected slice of what used to live in App.tsx —
// unlike useBudgets/useAssets/useCards, its handlers reach into `cards`,
// `activeCardId`, `dbName`, `currency`, and `transactions`, none of which it
// owns, so those are threaded in as read-only parameters. A few setters for
// state it likewise doesn't own (this card's category filter, the wizard,
// the reload token, the toast, the error banner) are threaded in the same
// way, for the handful of handlers that legitimately need to touch them
// (e.g. creating a category can un-hide it in the filter; importing a rules
// file can post a toast or trigger a reload).
//
// Every function below is an unmodified relocation of what used to live
// directly in App.tsx — only external closures became parameters.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  CategoryOverride,
  CategoryRule,
  KeywordRule,
  SubOverride,
  SubRule,
  Transaction,
} from '../types';
import {
  clearRuleDefinitions,
  deleteKeywordRule,
  deleteOverride,
  deleteRule,
  deleteSubOverride,
  deleteSubOverrides,
  deleteSubRule,
  getAllTransactions,
  getKeywordRules,
  getOverrides,
  getRules,
  getSubOverrides,
  getSubRules,
  saveCategorization,
  saveKeywordRule,
  saveKeywordRules,
  saveOverride,
  saveSubOverride,
  saveSubOverrides,
  saveSubRules,
} from '../lib/db';
import {
  type Card,
  scopedKey,
  CATEGORY_FILTER_KEY,
  COMBINED_CATEGORY_FILTER_KEY,
  CURRENCY_KEY,
  CUSTOM_CATEGORIES_GLOBAL_MIGRATION_KEY,
  CUSTOM_CATEGORIES_KEY,
  DEFAULT_CARD_ID,
  GLOBAL_RULES_DB,
  RULES_GLOBAL_MIGRATION_KEY,
} from '../lib/cards';
import type { CardSnapshot } from '../lib/combine';
import { EXPENSE_CATEGORIES, makeResolver, mergeByKey, signatureOf } from '../lib/categorize';
import { makeSubResolver, UNSORTED } from '../lib/subcategory';
import { buildGroups } from '../lib/grouping';
import {
  defaultCategoryFilter,
  excludeNewCategory,
  isValidCategoryFilter,
  type CategoryFilterState,
} from '../lib/categoryFilter';
import {
  buildRulesBackup,
  downloadRulesBackup,
  parseRulesBackup,
  restoreRulesBackup,
} from '../lib/exportData';

export interface OtherCardData {
  transactions: Transaction[];
  rules: CategoryRule[];
  overrides: CategoryOverride[];
  keywordRules: KeywordRule[];
  subRules: SubRule[];
  subOverrides: SubOverride[];
  currency: string;
}

interface Deps {
  cards: Card[];
  activeCardId: string;
  activeCard: Card | undefined;
  dbName: string;
  currency: string;
  transactions: Transaction[];
  setCategoryFilter: Dispatch<SetStateAction<CategoryFilterState>>;
  setCombinedCategoryFilter: Dispatch<SetStateAction<CategoryFilterState>>;
  setWizardOpen: Dispatch<SetStateAction<boolean>>;
  setReloadToken: Dispatch<SetStateAction<number>>;
  setToast: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function useRules(deps: Deps) {
  const {
    cards,
    activeCardId,
    activeCard,
    dbName,
    currency,
    transactions,
    setCategoryFilter,
    setCombinedCategoryFilter,
    setWizardOpen,
    setReloadToken,
    setToast,
    setError,
  } = deps;

  const [otherCardsData, setOtherCardsData] = useState<Record<string, OtherCardData>>({});

  // Categorization rules shared by every card by default (see lib/cards'
  // GLOBAL_RULES_DB doc comment). A one-time migration on first load under
  // this version moves every card's pre-existing rules here, since that's
  // what they always meant before per-card scoping existed.
  const [globalRules, setGlobalRules] = useState<CategoryRule[]>([]);
  const [globalKeywordRules, setGlobalKeywordRules] = useState<KeywordRule[]>([]);
  const [globalSubRules, setGlobalSubRules] = useState<SubRule[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  // Gates every other effect that reads a card's rules from IndexedDB (the
  // active-card loader in App.tsx, and the other-cards fetch below) so none
  // of them can read a card's rules mid-migration and cache a stale copy
  // that never refreshes — migration doesn't touch `cards` or `activeCardId`,
  // the only things those effects otherwise re-run on.
  const [rulesMigrationDone, setRulesMigrationDone] = useState(false);
  const cardsAtMountRef = useRef(cards);

  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [overrides, setOverrides] = useState<CategoryOverride[]>([]);
  const [keywordRules, setKeywordRules] = useState<KeywordRule[]>([]);
  const [subRules, setSubRules] = useState<SubRule[]>([]);
  const [subOverrides, setSubOverrides] = useState<SubOverride[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let migrated = false;
      try {
        migrated = localStorage.getItem(RULES_GLOBAL_MIGRATION_KEY) === '1';
      } catch {
        /* ignore */
      }
      if (!migrated) {
        // If this throws partway (e.g. an IndexedDB write fails), leave the
        // migration flag unset so it's retried next load instead of quietly
        // losing rules — but still fall through to unblock the rest of the
        // app below rather than leaving it stuck loading forever.
        try {
          for (const card of cardsAtMountRef.current) {
            const [r, kr, sr] = await Promise.all([
              getRules(card.dbName).catch(() => [] as CategoryRule[]),
              getKeywordRules(card.dbName).catch(() => [] as KeywordRule[]),
              getSubRules(card.dbName).catch(() => [] as SubRule[]),
            ]);
            if (r.length === 0 && kr.length === 0 && sr.length === 0) continue;
            if (r.length > 0) await saveCategorization(GLOBAL_RULES_DB, r, []);
            if (kr.length > 0) await saveKeywordRules(GLOBAL_RULES_DB, kr);
            if (sr.length > 0) await saveSubRules(GLOBAL_RULES_DB, sr);
            await clearRuleDefinitions(card.dbName);
          }
          localStorage.setItem(RULES_GLOBAL_MIGRATION_KEY, '1');
        } catch {
          /* ignore — retried next load */
        }
      }

      // One-time migration: custom categories used to be scoped per card;
      // a category name is meaningful on any card though, so they're
      // genuinely global now — union every card's list into the one shared,
      // unscoped key and drop the old per-card ones.
      let categoriesMigrated = false;
      try {
        categoriesMigrated = localStorage.getItem(CUSTOM_CATEGORIES_GLOBAL_MIGRATION_KEY) === '1';
      } catch {
        /* ignore */
      }
      if (!categoriesMigrated) {
        try {
          const seen = new Set<string>();
          const merged: string[] = [];
          for (const card of cardsAtMountRef.current) {
            const scoped = scopedKey(CUSTOM_CATEGORIES_KEY, card.id);
            try {
              const raw = JSON.parse(localStorage.getItem(scoped) ?? '[]');
              if (Array.isArray(raw)) {
                for (const c of raw) {
                  if (typeof c !== 'string') continue;
                  const key = c.toLowerCase();
                  if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(c);
                  }
                }
              }
            } catch {
              /* ignore this card's malformed list */
            }
            if (card.id !== DEFAULT_CARD_ID) localStorage.removeItem(scoped);
          }
          localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(merged));
          localStorage.setItem(CUSTOM_CATEGORIES_GLOBAL_MIGRATION_KEY, '1');
        } catch {
          /* ignore — retried next load */
        }
      }

      if (cancelled) return;
      setRulesMigrationDone(true);
      try {
        const [gr, gkr, gsr] = await Promise.all([
          getRules(GLOBAL_RULES_DB).catch(() => [] as CategoryRule[]),
          getKeywordRules(GLOBAL_RULES_DB).catch(() => [] as KeywordRule[]),
          getSubRules(GLOBAL_RULES_DB).catch(() => [] as SubRule[]),
        ]);
        if (cancelled) return;
        setGlobalRules(gr);
        setGlobalKeywordRules(gkr);
        setGlobalSubRules(gsr);
      } catch {
        /* leave global rule state empty; not fatal */
      }
      try {
        const rawCats = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? '[]');
        if (!cancelled) {
          setCustomCategories(Array.isArray(rawCats) ? rawCats.filter((c): c is string => typeof c === 'string') : []);
        }
      } catch {
        /* leave custom categories empty; not fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every other card's full data is kept loaded regardless of combine mode —
  // needed not just for combining, but so Advanced Settings can show every
  // card's rules and transaction counts at once, and so deleting a global
  // rule can freeze its effect on every card it actually touches. Waits for
  // the rules migration above so it never caches a card's pre-migration rules.
  useEffect(() => {
    if (!rulesMigrationDone) return;
    let cancelled = false;
    (async () => {
      const others = cards.filter((c) => c.id !== activeCardId);
      const entries = await Promise.all(
        others.map(async (c) => {
          const [txs, r, o, kr, sr, so] = await Promise.all([
            getAllTransactions(c.dbName).catch(() => [] as Transaction[]),
            getRules(c.dbName).catch(() => [] as CategoryRule[]),
            getOverrides(c.dbName).catch(() => [] as CategoryOverride[]),
            getKeywordRules(c.dbName).catch(() => [] as KeywordRule[]),
            getSubRules(c.dbName).catch(() => [] as SubRule[]),
            getSubOverrides(c.dbName).catch(() => [] as SubOverride[]),
          ]);
          let cur = 'OMR';
          try {
            cur = localStorage.getItem(scopedKey(CURRENCY_KEY, c.id)) || 'OMR';
          } catch {
            /* ignore */
          }
          const data: OtherCardData = {
            transactions: txs,
            rules: r,
            overrides: o,
            keywordRules: kr,
            subRules: sr,
            subOverrides: so,
            currency: cur,
          };
          return [c.id, data] as const;
        }),
      );
      if (cancelled) return;
      setOtherCardsData(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [cards, activeCardId, rulesMigrationDone]);

  // Global rules apply to every card by default; a card's own rules take
  // precedence over a global one with the same key (see mergeByKey).
  const effectiveRules = useMemo(
    () => mergeByKey(globalRules, rules, (r) => r.signature),
    [globalRules, rules],
  );
  const effectiveKeywordRules = useMemo(
    () => mergeByKey(globalKeywordRules, keywordRules, (r) => r.keyword),
    [globalKeywordRules, keywordRules],
  );
  const effectiveSubRules = useMemo(
    () => mergeByKey(globalSubRules, subRules, (r) => r.id),
    [globalSubRules, subRules],
  );
  const rulesMap = useMemo(() => new Map(effectiveRules.map((r) => [r.signature, r])), [effectiveRules]);
  const overridesMap = useMemo(
    () => new Map(overrides.map((o) => [o.id, o.category])),
    [overrides],
  );
  const categoryOf = useMemo(
    () => makeResolver(rulesMap, overridesMap, effectiveKeywordRules),
    [rulesMap, overridesMap, effectiveKeywordRules],
  );
  const subResolver = useMemo(() => {
    const perCard = makeSubResolver(effectiveSubRules, subOverrides);
    // "Is this category split, and what sub-category names exist under it"
    // should reflect every card's manual sub-category assignments, not just
    // this card's own — otherwise a sub-category that only exists via an
    // override on another card never shows up as an option here (or the
    // picker doesn't even appear, if this card has no split evidence of its
    // own). Resolving a specific transaction's own sub-category stays scoped
    // to this card's own overrides (perCard.subOf below) though — mixing in
    // another card's overrides there risks a rare same-id collision between
    // two unrelated transactions leaking one card's assignment onto the
    // other's transaction.
    const allSubOverrides = subOverrides.concat(Object.values(otherCardsData).flatMap((d) => d.subOverrides));
    const vocabulary = makeSubResolver(effectiveSubRules, allSubOverrides);
    return { subOf: perCard.subOf, splitParents: vocabulary.splitParents, subsForParent: vocabulary.subsForParent };
  }, [effectiveSubRules, subOverrides, otherCardsData]);

  // Every card's own resolver, built from its own rules merged with the
  // global ones — a card's transactions are always categorized by its own
  // effective rules, never the active card's. Always available (not gated on
  // combine mode) so Advanced Settings can show every card's rule matches
  // and counts, and so deleting a global rule can freeze its effect on every
  // card it actually touches.
  const allCardSnapshots = useMemo<CardSnapshot[]>(() => {
    if (!activeCard) return [];
    const activeSnap: CardSnapshot = {
      cardId: activeCard.id,
      cardName: activeCard.name,
      currency,
      transactions,
      categoryOf,
      subOf: subResolver.subOf,
    };
    const others = cards
      .filter((c) => c.id !== activeCardId)
      .map((c) => {
        const raw = otherCardsData[c.id];
        if (!raw) return null;
        const rMerged = mergeByKey(globalRules, raw.rules, (r) => r.signature);
        const rMap = new Map(rMerged.map((r) => [r.signature, r]));
        const oMap = new Map(raw.overrides.map((o) => [o.id, o.category]));
        const kwMerged = mergeByKey(globalKeywordRules, raw.keywordRules, (r) => r.keyword);
        const srMerged = mergeByKey(globalSubRules, raw.subRules, (r) => r.id);
        const snap: CardSnapshot = {
          cardId: c.id,
          cardName: c.name,
          currency: raw.currency,
          transactions: raw.transactions,
          categoryOf: makeResolver(rMap, oMap, kwMerged),
          subOf: makeSubResolver(srMerged, raw.subOverrides).subOf,
        };
        return snap;
      })
      .filter((s): s is CardSnapshot => s !== null);
    return [activeSnap, ...others];
  }, [
    activeCard,
    activeCardId,
    currency,
    transactions,
    categoryOf,
    subResolver,
    cards,
    otherCardsData,
    globalRules,
    globalKeywordRules,
    globalSubRules,
  ]);

  // Advanced Settings shows every card's rules (plus the global ones) all
  // at once — cardRuleSets carries each card's own card-specific rules,
  // untouched by merging, so the UI can label where each one actually lives
  // and route edits/deletes to the right place. allCardSnapshots (above)
  // supplies each card's transactions + effective resolver for counting
  // matches and for freezing a rule's effect on delete.
  const cardRuleSets = useMemo(
    () =>
      cards.map((c) => {
        if (c.id === activeCardId) {
          return { cardId: c.id, cardName: c.name, rules, keywordRules, subRules };
        }
        const raw = otherCardsData[c.id];
        return {
          cardId: c.id,
          cardName: c.name,
          rules: raw?.rules ?? [],
          keywordRules: raw?.keywordRules ?? [],
          subRules: raw?.subRules ?? [],
        };
      }),
    [cards, activeCardId, rules, keywordRules, subRules, otherCardsData],
  );

  // Classification (the wizard's pending groups) is independent of the display
  // filter — you can still categorize everything even if some of it is
  // excluded from the charts.
  const grouping = useMemo(
    () => buildGroups(transactions, rulesMap, overridesMap, effectiveKeywordRules),
    [transactions, rulesMap, overridesMap, effectiveKeywordRules],
  );

  const overriddenIds = useMemo(() => new Set(overrides.map((o) => o.id)), [overrides]);

  // --- Advanced Settings: rule operations scoped to either a specific card
  // or 'global' (shared by every card by default). Writes go to that scope's
  // own database; state updates go to the main state if the scope is the
  // active card, the global state if it's 'global', or otherCardsData for
  // any other card.
  const getScopeDbName = useCallback(
    (scope: string) => (scope === 'global' ? GLOBAL_RULES_DB : cards.find((c) => c.id === scope)?.dbName ?? dbName),
    [cards, dbName],
  );
  const updateScopeKeywordRules = useCallback(
    (scope: string, updater: (prev: KeywordRule[]) => KeywordRule[]) => {
      if (scope === 'global') {
        setGlobalKeywordRules(updater);
      } else if (scope === activeCardId) {
        setKeywordRules(updater);
      } else {
        setOtherCardsData((prev) => {
          const existing = prev[scope];
          if (!existing) return prev;
          return { ...prev, [scope]: { ...existing, keywordRules: updater(existing.keywordRules) } };
        });
      }
    },
    [activeCardId],
  );
  const updateScopeRules = useCallback(
    (scope: string, updater: (prev: CategoryRule[]) => CategoryRule[]) => {
      if (scope === 'global') {
        setGlobalRules(updater);
      } else if (scope === activeCardId) {
        setRules(updater);
      } else {
        setOtherCardsData((prev) => {
          const existing = prev[scope];
          if (!existing) return prev;
          return { ...prev, [scope]: { ...existing, rules: updater(existing.rules) } };
        });
      }
    },
    [activeCardId],
  );
  const updateScopeSubRules = useCallback(
    (scope: string, updater: (prev: SubRule[]) => SubRule[]) => {
      if (scope === 'global') {
        setGlobalSubRules(updater);
      } else if (scope === activeCardId) {
        setSubRules(updater);
      } else {
        setOtherCardsData((prev) => {
          const existing = prev[scope];
          if (!existing) return prev;
          return { ...prev, [scope]: { ...existing, subRules: updater(existing.subRules) } };
        });
      }
    },
    [activeCardId],
  );

  // Before a rule is deleted, freeze its current effect: every transaction it
  // was actually deciding (matches its pattern, isn't already overridden, and
  // currently shows exactly the category/sub-category the rule assigns) gets
  // an explicit override recording that category, so removing the rule can
  // never silently change what an already-categorized transaction shows. A
  // global rule can affect every card, so this checks each one individually
  // with that card's own effective resolver.
  const freezeCategoryForRule = useCallback(
    async (scope: string, category: string, matches: (t: Transaction) => boolean) => {
      const cardIds = scope === 'global' ? cards.map((c) => c.id) : [scope];
      for (const cardId of cardIds) {
        const card = cards.find((c) => c.id === cardId);
        if (!card) continue;
        const isActive = cardId === activeCardId;
        const txs = isActive ? transactions : otherCardsData[cardId]?.transactions;
        const existingOverrides = isActive ? overrides : otherCardsData[cardId]?.overrides;
        const snap = allCardSnapshots.find((s) => s.cardId === cardId);
        if (!txs || !existingOverrides || !snap) continue;
        const overriddenIds = new Set(existingOverrides.map((o) => o.id));
        const newOverrides: CategoryOverride[] = [];
        for (const t of txs) {
          if (overriddenIds.has(t.id) || !matches(t) || snap.categoryOf(t) !== category) continue;
          newOverrides.push({ id: t.id, category, updatedAt: Date.now() });
        }
        if (newOverrides.length === 0) continue;
        await saveCategorization(card.dbName, [], newOverrides);
        const newIds = new Set(newOverrides.map((o) => o.id));
        if (isActive) {
          setOverrides((prev) => [...prev.filter((o) => !newIds.has(o.id)), ...newOverrides]);
        } else {
          setOtherCardsData((prev) => {
            const existing = prev[cardId];
            if (!existing) return prev;
            return {
              ...prev,
              [cardId]: { ...existing, overrides: [...existing.overrides.filter((o) => !newIds.has(o.id)), ...newOverrides] },
            };
          });
        }
      }
    },
    [cards, activeCardId, transactions, overrides, otherCardsData, allCardSnapshots],
  );

  const freezeSubForRule = useCallback(
    async (scope: string, parent: string, sub: string, matches: (t: Transaction) => boolean) => {
      const cardIds = scope === 'global' ? cards.map((c) => c.id) : [scope];
      for (const cardId of cardIds) {
        const card = cards.find((c) => c.id === cardId);
        if (!card) continue;
        const isActive = cardId === activeCardId;
        const txs = isActive ? transactions : otherCardsData[cardId]?.transactions;
        const existingSubOverrides = isActive ? subOverrides : otherCardsData[cardId]?.subOverrides;
        const snap = allCardSnapshots.find((s) => s.cardId === cardId);
        if (!txs || !existingSubOverrides || !snap) continue;
        const overriddenIds = new Set(existingSubOverrides.map((o) => o.id));
        const newSubOverrides: SubOverride[] = [];
        for (const t of txs) {
          if (overriddenIds.has(t.id) || !matches(t)) continue;
          if (snap.categoryOf(t) !== parent || snap.subOf(t, parent) !== sub) continue;
          newSubOverrides.push({ id: t.id, parent, sub, updatedAt: Date.now() });
        }
        if (newSubOverrides.length === 0) continue;
        await saveSubOverrides(card.dbName, newSubOverrides);
        const newIds = new Set(newSubOverrides.map((o) => o.id));
        if (isActive) {
          setSubOverrides((prev) => [...prev.filter((o) => !newIds.has(o.id)), ...newSubOverrides]);
        } else {
          setOtherCardsData((prev) => {
            const existing = prev[cardId];
            if (!existing) return prev;
            return {
              ...prev,
              [cardId]: {
                ...existing,
                subOverrides: [...existing.subOverrides.filter((o) => !newIds.has(o.id)), ...newSubOverrides],
              },
            };
          });
        }
      }
    },
    [cards, activeCardId, transactions, subOverrides, otherCardsData, allCardSnapshots],
  );

  const handleCreateKeywordRuleFor = useCallback(
    (scope: string, keyword: string, category: string) => {
      const rule: KeywordRule = { keyword, category, priority: 1, createdAt: Date.now(), updatedAt: Date.now() };
      saveKeywordRule(getScopeDbName(scope), rule);
      updateScopeKeywordRules(scope, (prev) => [...prev.filter((r) => r.keyword !== keyword), rule]);
      setToast(`Rule saved · “${keyword}” → ${category}`);
    },
    [getScopeDbName, updateScopeKeywordRules, setToast],
  );

  const handleDeleteKeywordRuleFor = useCallback(
    async (scope: string, keyword: string, category: string) => {
      await freezeCategoryForRule(scope, category, (t) => t.description.toLowerCase().includes(keyword));
      deleteKeywordRule(getScopeDbName(scope), keyword);
      updateScopeKeywordRules(scope, (prev) => prev.filter((r) => r.keyword !== keyword));
    },
    [freezeCategoryForRule, getScopeDbName, updateScopeKeywordRules],
  );

  // Direct priority set (1-10, higher wins a conflict between two matching
  // rules) — the user-facing replacement for the old drag/arrow reordering.
  const handleSetKeywordRulePriority = useCallback(
    (scope: string, keyword: string, priority: number) => {
      updateScopeKeywordRules(scope, (prev) => {
        const existing = prev.find((r) => r.keyword === keyword);
        if (!existing) return prev;
        const updated: KeywordRule = { ...existing, priority };
        saveKeywordRule(getScopeDbName(scope), updated);
        return prev.map((r) => (r.keyword === keyword ? updated : r));
      });
    },
    [getScopeDbName, updateScopeKeywordRules],
  );

  // One-click fix for a shadowed rule (see AdvancedSettingsPage's shadow
  // detection): bump it to the same priority tier as whatever's shadowing
  // it, but created just after — same tier means it doesn't need to fight
  // for a free number 1-10, and being newer within that tier is enough to
  // win the tie-break, so the other rule never needs to move. Works even
  // when the shadowing rule lives in a different scope (e.g. a card rule
  // shadowed by a global one).
  const handlePromoteKeywordRuleAbove = useCallback(
    (scope: string, keyword: string, abovePriority: number, aboveCreatedAt: number) => {
      updateScopeKeywordRules(scope, (prev) => {
        const existing = prev.find((r) => r.keyword === keyword);
        if (!existing) return prev;
        const updated: KeywordRule = { ...existing, priority: abovePriority, createdAt: aboveCreatedAt + 1 };
        saveKeywordRule(getScopeDbName(scope), updated);
        return prev.map((r) => (r.keyword === keyword ? updated : r));
      });
    },
    [getScopeDbName, updateScopeKeywordRules],
  );

  // Editing a keyword rule's target category in place — unlike creating a new
  // rule with that keyword, this keeps the rule's existing priority instead
  // of bumping it to "newest wins".
  const handleUpdateKeywordRuleCategory = useCallback(
    (scope: string, keyword: string, category: string) => {
      updateScopeKeywordRules(scope, (prev) => {
        const existing = prev.find((r) => r.keyword === keyword);
        if (!existing) return prev;
        const updated: KeywordRule = { ...existing, category, updatedAt: Date.now() };
        saveKeywordRule(getScopeDbName(scope), updated);
        return prev.map((r) => (r.keyword === keyword ? updated : r));
      });
    },
    [getScopeDbName, updateScopeKeywordRules],
  );

  const handleUpdateSignatureRuleCategory = useCallback(
    (scope: string, signature: string, category: string) => {
      updateScopeRules(scope, (prev) => {
        const existing = prev.find((r) => r.signature === signature);
        if (!existing) return prev;
        const updated: CategoryRule = { ...existing, category, updatedAt: Date.now() };
        saveCategorization(getScopeDbName(scope), [updated], []);
        return prev.map((r) => (r.signature === signature ? updated : r));
      });
    },
    [getScopeDbName, updateScopeRules],
  );

  const handleDeleteSignatureRule = useCallback(
    async (scope: string, signature: string, category: string) => {
      await freezeCategoryForRule(scope, category, (t) => t.amount < 0 && signatureOf(t.description) === signature);
      deleteRule(getScopeDbName(scope), signature);
      updateScopeRules(scope, (prev) => prev.filter((r) => r.signature !== signature));
    },
    [freezeCategoryForRule, getScopeDbName, updateScopeRules],
  );

  const handleCreateSubRule = useCallback(
    (scope: string, parent: string, keyword: string, subName: string) => {
      const kw = keyword.trim().toLowerCase();
      if (!parent || !kw || !subName) return;
      const rule: SubRule = {
        id: `${parent}${kw}`,
        parent,
        keyword: kw,
        sub: subName,
        priority: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveSubRules(getScopeDbName(scope), [rule]);
      updateScopeSubRules(scope, (prev) => [...prev.filter((r) => r.id !== rule.id), rule]);
      setToast(`Sub-category rule saved · "${kw}" → ${parent} / ${subName}`);
    },
    [getScopeDbName, updateScopeSubRules, setToast],
  );

  const handleDeleteSubRule = useCallback(
    async (scope: string, id: string, info: { parent: string; sub: string; keyword: string }) => {
      await freezeSubForRule(scope, info.parent, info.sub, (t) => t.description.toLowerCase().includes(info.keyword));
      deleteSubRule(getScopeDbName(scope), id);
      updateScopeSubRules(scope, (prev) => prev.filter((r) => r.id !== id));
    },
    [freezeSubForRule, getScopeDbName, updateScopeSubRules],
  );

  // A sub-rule's id is derived from its (parent, keyword) pair, so moving it
  // to a different category means replacing it under a new id rather than
  // updating the existing record in place.
  const handleReparentSubRule = useCallback(
    (scope: string, id: string, newParent: string) => {
      updateScopeSubRules(scope, (prev) => {
        const existing = prev.find((r) => r.id === id);
        if (!existing || existing.parent === newParent) return prev;
        const updated: SubRule = { ...existing, parent: newParent, id: `${newParent}${existing.keyword}`, updatedAt: Date.now() };
        const targetDbName = getScopeDbName(scope);
        deleteSubRule(targetDbName, id);
        saveSubRules(targetDbName, [updated]);
        return [...prev.filter((r) => r.id !== id), updated];
      });
    },
    [getScopeDbName, updateScopeSubRules],
  );

  // Direct priority set (1-10) for sub-rules — same replacement as keyword
  // rules above, scoped to siblings under the same parent category.
  const handleSetSubRulePriority = useCallback(
    (scope: string, id: string, priority: number) => {
      updateScopeSubRules(scope, (prev) => {
        const existing = prev.find((r) => r.id === id);
        if (!existing) return prev;
        const updated: SubRule = { ...existing, priority };
        saveSubRules(getScopeDbName(scope), [updated]);
        return prev.map((r) => (r.id === id ? updated : r));
      });
    },
    [getScopeDbName, updateScopeSubRules],
  );

  // Merchant rules never conflict with each other (each is keyed by a unique
  // signature, so at most one can ever match a given transaction) — this
  // reorder is purely for the user's own browsing order, not resolution.
  const handleReorderSignatureRule = useCallback(
    (scope: string, signature: string, direction: 'up' | 'down') => {
      updateScopeRules(scope, (prev) => {
        const sorted = [...prev].sort((a, b) => b.createdAt - a.createdAt);
        const idx = sorted.findIndex((r) => r.signature === signature);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return prev;
        const a = sorted[idx];
        const b = sorted[swapIdx];
        const updatedA: CategoryRule = { ...a, createdAt: b.createdAt };
        const updatedB: CategoryRule = { ...b, createdAt: a.createdAt };
        saveCategorization(getScopeDbName(scope), [updatedA, updatedB], []);
        return prev.map((r) =>
          r.signature === updatedA.signature ? updatedA : r.signature === updatedB.signature ? updatedB : r,
        );
      });
    },
    [getScopeDbName, updateScopeRules],
  );

  // Drag-and-drop support (and cross-scope drag): bump just this rule's
  // priority to sit right above whatever it was dropped onto, exactly like
  // the shadow-warning's "Move above" fix — no need to touch the target.
  const handlePromoteSignatureRuleAbove = useCallback(
    (scope: string, signature: string, aboveCreatedAt: number) => {
      updateScopeRules(scope, (prev) => {
        const existing = prev.find((r) => r.signature === signature);
        if (!existing) return prev;
        const updated: CategoryRule = { ...existing, createdAt: aboveCreatedAt + 1 };
        saveCategorization(getScopeDbName(scope), [updated], []);
        return prev.map((r) => (r.signature === signature ? updated : r));
      });
    },
    [getScopeDbName, updateScopeRules],
  );

  const handlePromoteSubRuleAbove = useCallback(
    (scope: string, id: string, abovePriority: number, aboveCreatedAt: number) => {
      updateScopeSubRules(scope, (prev) => {
        const existing = prev.find((r) => r.id === id);
        if (!existing) return prev;
        const updated: SubRule = { ...existing, priority: abovePriority, createdAt: aboveCreatedAt + 1 };
        saveSubRules(getScopeDbName(scope), [updated]);
        return prev.map((r) => (r.id === id ? updated : r));
      });
    },
    [getScopeDbName, updateScopeSubRules],
  );

  // --- Promote a card-specific rule to global --------------------------------
  // Read-only lookups mirroring getScopeDbName, for the promote handlers below
  // to find a rule's current value before moving it.
  const getScopeKeywordRules = useCallback(
    (scope: string): KeywordRule[] => {
      if (scope === 'global') return globalKeywordRules;
      if (scope === activeCardId) return keywordRules;
      return otherCardsData[scope]?.keywordRules ?? [];
    },
    [globalKeywordRules, activeCardId, keywordRules, otherCardsData],
  );
  const getScopeRules = useCallback(
    (scope: string): CategoryRule[] => {
      if (scope === 'global') return globalRules;
      if (scope === activeCardId) return rules;
      return otherCardsData[scope]?.rules ?? [];
    },
    [globalRules, activeCardId, rules, otherCardsData],
  );
  const getScopeSubRules = useCallback(
    (scope: string): SubRule[] => {
      if (scope === 'global') return globalSubRules;
      if (scope === activeCardId) return subRules;
      return otherCardsData[scope]?.subRules ?? [];
    },
    [globalSubRules, activeCardId, subRules, otherCardsData],
  );

  // Moving a card rule to global keeps its category, sub-category coverage,
  // and createdAt (so its priority position carries over) — it just now
  // applies everywhere. If a global rule already existed for the same
  // keyword/signature/id, this intentionally replaces it: promoting a card's
  // override is "make my version the new default."
  const handleMoveKeywordRuleToGlobal = useCallback(
    (fromScope: string, keyword: string) => {
      if (fromScope === 'global') return;
      const existing = getScopeKeywordRules(fromScope).find((r) => r.keyword === keyword);
      if (!existing) return;
      deleteKeywordRule(getScopeDbName(fromScope), keyword);
      updateScopeKeywordRules(fromScope, (prev) => prev.filter((r) => r.keyword !== keyword));
      saveKeywordRule(getScopeDbName('global'), existing);
      updateScopeKeywordRules('global', (prev) => [...prev.filter((r) => r.keyword !== keyword), existing]);
      setToast(`"${keyword}" is now a global rule.`);
    },
    [getScopeKeywordRules, getScopeDbName, updateScopeKeywordRules, setToast],
  );

  const handleMoveSignatureRuleToGlobal = useCallback(
    (fromScope: string, signature: string) => {
      if (fromScope === 'global') return;
      const existing = getScopeRules(fromScope).find((r) => r.signature === signature);
      if (!existing) return;
      deleteRule(getScopeDbName(fromScope), signature);
      updateScopeRules(fromScope, (prev) => prev.filter((r) => r.signature !== signature));
      saveCategorization(getScopeDbName('global'), [existing], []);
      updateScopeRules('global', (prev) => [...prev.filter((r) => r.signature !== signature), existing]);
      setToast(`Merchant rule "${signature}" is now global.`);
    },
    [getScopeRules, getScopeDbName, updateScopeRules, setToast],
  );

  const handleMoveSubRuleToGlobal = useCallback(
    (fromScope: string, id: string) => {
      if (fromScope === 'global') return;
      const existing = getScopeSubRules(fromScope).find((r) => r.id === id);
      if (!existing) return;
      deleteSubRule(getScopeDbName(fromScope), id);
      updateScopeSubRules(fromScope, (prev) => prev.filter((r) => r.id !== id));
      saveSubRules(getScopeDbName('global'), [existing]);
      updateScopeSubRules('global', (prev) => [...prev.filter((r) => r.id !== id), existing]);
      setToast(`Sub-category rule "${existing.keyword}" is now global.`);
    },
    [getScopeSubRules, getScopeDbName, updateScopeSubRules, setToast],
  );

  const handleCreateCategory = useCallback(
    (rawName: string) => {
      setCustomCategories((prev) => {
        const exists =
          prev.some((c) => c.toLowerCase() === rawName.toLowerCase()) ||
          EXPENSE_CATEGORIES.some((c) => c.toLowerCase() === rawName.toLowerCase());
        if (exists) return prev;
        const next = [...prev, rawName];
        try {
          localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      // A category that didn't exist when the user narrowed "Show in charts &
      // totals" down to a subset shouldn't silently start out visible — keep
      // it hidden (both this card's filter and the combined view's) until
      // it's explicitly checked back on.
      setCategoryFilter((prev) => {
        const next = excludeNewCategory(prev, rawName);
        if (next === prev) return prev;
        try {
          localStorage.setItem(scopedKey(CATEGORY_FILTER_KEY, activeCardId), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      setCombinedCategoryFilter((prev) => {
        const next = excludeNewCategory(prev, rawName);
        if (next === prev) return prev;
        try {
          localStorage.setItem(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [activeCardId, setCategoryFilter, setCombinedCategoryFilter],
  );

  // Custom categories are global (see lib/cards' CUSTOM_CATEGORIES_KEY doc
  // comment) — creating one for any scope adds it to the one shared list.
  // Only "keep it hidden until explicitly shown" still depends on scope,
  // since each card (and the combined view) keeps its own category filter.
  const handleCreateCategoryFor = useCallback(
    (scope: string, rawName: string) => {
      if (scope === 'global' || scope === activeCardId) {
        handleCreateCategory(rawName);
        return;
      }
      setCustomCategories((prev) => {
        const exists =
          prev.some((c) => c.toLowerCase() === rawName.toLowerCase()) ||
          EXPENSE_CATEGORIES.some((c) => c.toLowerCase() === rawName.toLowerCase());
        if (exists) return prev;
        const next = [...prev, rawName];
        try {
          localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      try {
        const filterKey = scopedKey(CATEGORY_FILTER_KEY, scope);
        const savedFilter = JSON.parse(localStorage.getItem(filterKey) ?? 'null');
        const scopeFilter = isValidCategoryFilter(savedFilter) ? savedFilter : defaultCategoryFilter();
        const nextFilter = excludeNewCategory(scopeFilter, rawName);
        if (nextFilter !== scopeFilter) localStorage.setItem(filterKey, JSON.stringify(nextFilter));
      } catch {
        /* ignore */
      }
      setCombinedCategoryFilter((prevFilter) => {
        const next = excludeNewCategory(prevFilter, rawName);
        if (next === prevFilter) return prevFilter;
        try {
          localStorage.setItem(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [activeCardId, handleCreateCategory, setCombinedCategoryFilter],
  );

  const handleWizardComplete = useCallback(
    async (newRules: CategoryRule[], newOverrides: CategoryOverride[], newKeywordRules: KeywordRule[]) => {
      // Merge: new decisions replace any existing rule/override with the same key.
      const mergedRules = new Map(rules.map((r) => [r.signature, r]));
      for (const r of newRules) mergedRules.set(r.signature, r);
      const mergedOverrides = new Map(overrides.map((o) => [o.id, o]));
      for (const o of newOverrides) mergedOverrides.set(o.id, o);

      await saveCategorization(dbName, newRules, newOverrides);
      setRules([...mergedRules.values()]);
      setOverrides([...mergedOverrides.values()]);
      // Keyword rules split off in the wizard are, like every other rule,
      // shared by every card by default.
      for (const kr of newKeywordRules) handleCreateKeywordRuleFor('global', kr.keyword, kr.category);
      setWizardOpen(false);
      const n = newRules.length + newOverrides.length + newKeywordRules.length;
      if (n > 0) {
        setToast(`Categorization saved · ${newRules.length + newKeywordRules.length} rules applied`);
      }
    },
    [rules, overrides, dbName, handleCreateKeywordRuleFor, setWizardOpen, setToast],
  );

  const handleSetCategory = useCallback(
    (id: string, category: string) => {
      const o: CategoryOverride = { id, category, updatedAt: Date.now() };
      saveOverride(dbName, o);
      setOverrides((prev) => [...prev.filter((x) => x.id !== id), o]);
    },
    [dbName],
  );

  const handleClearCategory = useCallback(
    (id: string) => {
      deleteOverride(dbName, id);
      setOverrides((prev) => prev.filter((x) => x.id !== id));
    },
    [dbName],
  );

  const handleSetSubCategory = useCallback(
    (id: string, parent: string, subName: string) => {
      if (subName === UNSORTED) {
        deleteSubOverride(dbName, id);
        setSubOverrides((prev) => prev.filter((o) => o.id !== id));
        return;
      }
      const o: SubOverride = { id, parent, sub: subName, updatedAt: Date.now() };
      saveSubOverride(dbName, o);
      setSubOverrides((prev) => [...prev.filter((x) => x.id !== id), o]);
    },
    [dbName],
  );

  const handleBulkSetSubCategory = useCallback(
    (ids: string[], parent: string, subName: string) => {
      if (subName === UNSORTED) {
        deleteSubOverrides(dbName, ids);
        const idSet = new Set(ids);
        setSubOverrides((prev) => prev.filter((o) => !idSet.has(o.id)));
        return;
      }
      const newOverrides = ids.map((id) => ({ id, parent, sub: subName, updatedAt: Date.now() }));
      saveSubOverrides(dbName, newOverrides);
      setSubOverrides((prev) => {
        const idSet = new Set(ids);
        return [...prev.filter((o) => !idSet.has(o.id)), ...newOverrides];
      });
      setToast(`Sub-category applied · ${ids.length} transaction${ids.length === 1 ? '' : 's'} → ${subName}`);
    },
    [dbName, setToast],
  );

  const handleExportRulesBackup = useCallback(async () => {
    try {
      const backup = await buildRulesBackup(cards);
      downloadRulesBackup(backup);
    } catch (e) {
      setToast(`Could not export rules. ${(e as Error).message ?? ''}`.trim());
    }
  }, [cards, setToast]);

  const handleImportRulesFile = useCallback(
    async (file: File) => {
      try {
        const backup = parseRulesBackup(await file.text());
        const ruleCount =
          backup.globalRules.length +
          backup.globalKeywordRules.length +
          backup.globalSubRules.length +
          backup.cards.reduce((a, c) => a + c.rules.length + c.keywordRules.length + c.subRules.length, 0);
        const ok = confirm(
          `Import this rules file (from ${backup.exportedAt.slice(0, 10)})? It covers ${ruleCount} rule` +
            `${ruleCount === 1 ? '' : 's'} across ${backup.cards.length} card` +
            `${backup.cards.length === 1 ? '' : 's'} plus global rules. Existing rules are kept, ` +
            'matching ones are overwritten, nothing is deleted.',
        );
        if (!ok) return;
        const result = await restoreRulesBackup(backup, cards);
        setGlobalRules(result.globalRules);
        setGlobalKeywordRules(result.globalKeywordRules);
        setGlobalSubRules(result.globalSubRules);
        setCustomCategories(result.customCategories);
        setReloadToken((n) => n + 1);
        setToast(
          result.skippedCards.length > 0
            ? `Rules imported. Skipped (no matching card): ${result.skippedCards.join(', ')}`
            : 'Rules imported.',
        );
      } catch (e) {
        setError(`Could not import that rules file. ${(e as Error).message ?? ''}`.trim());
      }
    },
    [cards, setReloadToken, setToast, setError],
  );

  return {
    // State
    rules,
    setRules,
    overrides,
    setOverrides,
    keywordRules,
    setKeywordRules,
    subRules,
    setSubRules,
    subOverrides,
    setSubOverrides,
    globalRules,
    setGlobalRules,
    globalKeywordRules,
    setGlobalKeywordRules,
    globalSubRules,
    setGlobalSubRules,
    customCategories,
    setCustomCategories,
    otherCardsData,
    setOtherCardsData,
    rulesMigrationDone,
    // Derived
    categoryOf,
    subResolver,
    allCardSnapshots,
    cardRuleSets,
    grouping,
    overriddenIds,
    // Handlers
    handleCreateKeywordRuleFor,
    handleDeleteKeywordRuleFor,
    handleSetKeywordRulePriority,
    handlePromoteKeywordRuleAbove,
    handleUpdateKeywordRuleCategory,
    handleUpdateSignatureRuleCategory,
    handleDeleteSignatureRule,
    handleReorderSignatureRule,
    handlePromoteSignatureRuleAbove,
    handleCreateSubRule,
    handleDeleteSubRule,
    handleReparentSubRule,
    handleSetSubRulePriority,
    handlePromoteSubRuleAbove,
    handleMoveKeywordRuleToGlobal,
    handleMoveSignatureRuleToGlobal,
    handleMoveSubRuleToGlobal,
    handleCreateCategory,
    handleCreateCategoryFor,
    handleWizardComplete,
    handleSetCategory,
    handleClearCategory,
    handleSetSubCategory,
    handleBulkSetSubCategory,
    handleExportRulesBackup,
    handleImportRulesFile,
  };
}
