// Card identity, lifecycle (create/rename/merge/delete/switch), and the
// active-card pointer that most of the rest of the app reads. Unlike
// useBudgets/useAssets this can't own all of its own state in isolation —
// creating, merging, or deleting a card also has to touch a handful of other
// domains' state (per-card balances records, the active card's category
// filter, the wizard, the reload token, the toast) — so those setters are
// threaded in as parameters rather than duplicated here. Every handler below
// is an unmodified relocation of what used to live directly in App.tsx.

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  addTransactions,
  deleteCardDatabase,
  getAllTransactions,
  getKeywordRules,
  getOverrides,
  getRules,
  getSubOverrides,
  getSubRules,
  saveCategorization,
  saveKeywordRules,
  saveSubOverrides,
  saveSubRules,
} from '../lib/db';
import {
  type Card,
  loadActiveCardId,
  loadCards,
  makeCard,
  saveActiveCardId,
  saveCards,
  scopedKey,
  CATEGORY_FILTER_KEY,
  CURRENCY_KEY,
  MONTH_START_KEY,
  WEEK_START_KEY,
  CARD_TYPE_KEY,
  BALANCE_CHECKPOINTS_KEY,
  COMBINE_KEY,
  COMBINE_CARD_ID,
} from '../lib/cards';
import type { CopyOptions } from '../components/CardManager';
import { mergeByKey } from '../lib/categorize';
import {
  defaultCategoryFilter,
  isValidCategoryFilter,
  unionCategoryFilter,
  type CategoryFilterState,
} from '../lib/categoryFilter';
import { mergeCheckpoints, type BalanceCheckpoint, type CardType } from '../lib/balances';

interface Deps {
  combineEnabled: boolean;
  setCombineEnabled: Dispatch<SetStateAction<boolean>>;
  cardCheckpoints: Record<string, BalanceCheckpoint[]>;
  setCardTypes: Dispatch<SetStateAction<Record<string, CardType>>>;
  setCardCheckpoints: Dispatch<SetStateAction<Record<string, BalanceCheckpoint[]>>>;
  setCategoryFilter: Dispatch<SetStateAction<CategoryFilterState>>;
  setWizardOpen: Dispatch<SetStateAction<boolean>>;
  setReloadToken: Dispatch<SetStateAction<number>>;
  setToast: Dispatch<SetStateAction<string | null>>;
}

export function useCards(deps: Deps) {
  const {
    combineEnabled,
    setCombineEnabled,
    cardCheckpoints,
    setCardTypes,
    setCardCheckpoints,
    setCategoryFilter,
    setWizardOpen,
    setReloadToken,
    setToast,
  } = deps;

  const [cards, setCards] = useState<Card[]>(() => loadCards());
  const [activeCardId, setActiveCardId] = useState<string>(() => loadActiveCardId(loadCards()));
  const [cardManagerOpen, setCardManagerOpen] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const activeCard = useMemo(
    () => cards.find((c) => c.id === activeCardId) ?? cards[0],
    [cards, activeCardId],
  );
  const dbName = activeCard?.dbName ?? 'cashflow';

  const handleSwitchCard = useCallback(
    (id: string) => {
      if (id === COMBINE_CARD_ID) {
        if (combineEnabled) return;
        setCombineEnabled(true);
        try {
          localStorage.setItem(COMBINE_KEY, '1');
        } catch {
          /* ignore */
        }
        return;
      }
      const wasCombined = combineEnabled;
      if (wasCombined) {
        setCombineEnabled(false);
        try {
          localStorage.setItem(COMBINE_KEY, '0');
        } catch {
          /* ignore */
        }
      }
      if (id === activeCardId) return;
      setActiveCardId(id);
      saveActiveCardId(id);
      // Keep whichever tab (Dashboard/Categories/Transactions) the user was
      // already on — switching cards shouldn't reset where you're looking.
      setWizardOpen(false);
    },
    [activeCardId, combineEnabled, setCombineEnabled, setWizardOpen],
  );

  const handleCreateCard = useCallback(
    async (name: string, copyFromId: string | null, opts: CopyOptions) => {
      setCardBusy(true);
      try {
        const card = makeCard(name);
        const source = copyFromId ? cards.find((c) => c.id === copyFromId) : undefined;
        if (source) {
          if (opts.rules) {
            const srcRules = await getRules(source.dbName);
            // Exclusion lists reference the source card's transaction ids,
            // which are meaningless (and never present) on a brand-new card.
            const cleaned = srcRules.map((r) => ({ ...r, excludedIds: [] }));
            if (cleaned.length > 0) await saveCategorization(card.dbName, cleaned, []);
          }
          if (opts.keywords) {
            const srcKeywords = await getKeywordRules(source.dbName);
            if (srcKeywords.length > 0) await saveKeywordRules(card.dbName, srcKeywords);
          }
          if (opts.subRules) {
            const srcSubRules = await getSubRules(source.dbName);
            if (srcSubRules.length > 0) await saveSubRules(card.dbName, srcSubRules);
          }
          // Custom categories are global (see lib/cards' CUSTOM_CATEGORIES_KEY
          // doc comment) — a new card already sees every one of them, nothing
          // to copy.
        }
        const next = [...cards, card];
        setCards(next);
        saveCards(next);
        setCardTypes((prev) => ({ ...prev, [card.id]: 'debit' }));
        setCardCheckpoints((prev) => ({ ...prev, [card.id]: [] }));
        setActiveCardId(card.id);
        saveActiveCardId(card.id);
        setWizardOpen(false);
        setCardManagerOpen(false);
        setToast(`Card created · ${card.name}`);
      } catch (e) {
        setToast(`Could not create card. ${(e as Error).message ?? ''}`.trim());
      } finally {
        setCardBusy(false);
      }
    },
    [cards, setCardTypes, setCardCheckpoints, setWizardOpen, setToast],
  );

  // Absorbs `source` into `target`: transactions move over (the same
  // dedup-by-content logic a normal import uses, so a statement present on
  // both cards isn't duplicated), each card's own rule overrides and
  // category filter are merged (target's own entries win a same-key
  // conflict, since it's the card that survives), and `source` is deleted
  // entirely once its data has landed. Triggered by renaming a card to
  // (near-)match another one's name — see handleRenameCard below.
  const handleMergeCards = useCallback(
    async (source: Card, target: Card) => {
      setCardBusy(true);
      try {
        const srcTxs = await getAllTransactions(source.dbName);
        if (srcTxs.length > 0) await addTransactions(target.dbName, srcTxs, `merge-${source.name}`);

        const [srcRules, srcOverrides, srcKeywords, srcSubRules, srcSubOverrides, tgtRules, tgtKeywords, tgtSubRules] =
          await Promise.all([
            getRules(source.dbName),
            getOverrides(source.dbName),
            getKeywordRules(source.dbName),
            getSubRules(source.dbName),
            getSubOverrides(source.dbName),
            getRules(target.dbName),
            getKeywordRules(target.dbName),
            getSubRules(target.dbName),
          ]);
        const mergedRules = mergeByKey(srcRules, tgtRules, (r) => r.signature);
        const mergedKeywords = mergeByKey(srcKeywords, tgtKeywords, (r) => r.keyword);
        const mergedSubRules = mergeByKey(srcSubRules, tgtSubRules, (r) => r.id);
        await saveCategorization(target.dbName, mergedRules, srcOverrides);
        if (mergedKeywords.length > 0) await saveKeywordRules(target.dbName, mergedKeywords);
        if (mergedSubRules.length > 0) await saveSubRules(target.dbName, mergedSubRules);
        if (srcSubOverrides.length > 0) await saveSubOverrides(target.dbName, srcSubOverrides);

        try {
          const srcFilterRaw = JSON.parse(localStorage.getItem(scopedKey(CATEGORY_FILTER_KEY, source.id)) ?? 'null');
          const tgtFilterRaw = JSON.parse(localStorage.getItem(scopedKey(CATEGORY_FILTER_KEY, target.id)) ?? 'null');
          const srcFilter = isValidCategoryFilter(srcFilterRaw) ? srcFilterRaw : defaultCategoryFilter();
          const tgtFilter = isValidCategoryFilter(tgtFilterRaw) ? tgtFilterRaw : defaultCategoryFilter();
          const mergedFilter = unionCategoryFilter(srcFilter, tgtFilter);
          localStorage.setItem(scopedKey(CATEGORY_FILTER_KEY, target.id), JSON.stringify(mergedFilter));
          if (target.id === activeCardId) setCategoryFilter(mergedFilter);
        } catch {
          /* ignore */
        }

        const mergedCheckpoints = mergeCheckpoints(cardCheckpoints[source.id] ?? [], cardCheckpoints[target.id] ?? []);
        try {
          localStorage.setItem(scopedKey(BALANCE_CHECKPOINTS_KEY, target.id), JSON.stringify(mergedCheckpoints));
        } catch {
          /* ignore */
        }

        await deleteCardDatabase(source.dbName);
        try {
          localStorage.removeItem(scopedKey(CATEGORY_FILTER_KEY, source.id));
          localStorage.removeItem(scopedKey(CURRENCY_KEY, source.id));
          localStorage.removeItem(scopedKey(MONTH_START_KEY, source.id));
          localStorage.removeItem(scopedKey(WEEK_START_KEY, source.id));
          localStorage.removeItem(scopedKey(CARD_TYPE_KEY, source.id));
          localStorage.removeItem(scopedKey(BALANCE_CHECKPOINTS_KEY, source.id));
        } catch {
          /* ignore */
        }

        const next = cards.filter((c) => c.id !== source.id);
        setCards(next);
        saveCards(next);
        setCardTypes((prev) => {
          const rest = { ...prev };
          delete rest[source.id];
          return rest;
        });
        setCardCheckpoints((prev) => {
          const rest = { ...prev };
          delete rest[source.id];
          rest[target.id] = mergedCheckpoints;
          return rest;
        });

        if (source.id === activeCardId) {
          setActiveCardId(target.id);
          saveActiveCardId(target.id);
        } else if (target.id === activeCardId) {
          setReloadToken((n) => n + 1);
        }

        if (next.length <= 1 && combineEnabled) {
          setCombineEnabled(false);
          try {
            localStorage.setItem(COMBINE_KEY, '0');
          } catch {
            /* ignore */
          }
        }

        setToast(`Merged "${source.name}" into "${target.name}"`);
      } catch (e) {
        setToast(`Could not merge cards. ${(e as Error).message ?? ''}`.trim());
      } finally {
        setCardBusy(false);
      }
    },
    [
      cards,
      activeCardId,
      combineEnabled,
      cardCheckpoints,
      setCombineEnabled,
      setCardTypes,
      setCardCheckpoints,
      setCategoryFilter,
      setReloadToken,
      setToast,
    ],
  );

  const handleRenameCard = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const source = cards.find((c) => c.id === id);
      if (!source) return;
      const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const target = cards.find((c) => c.id !== id && normalize(c.name) === normalize(trimmed));
      if (target) {
        const proceed = confirm(
          `A card named "${target.name}" already exists. Merge "${source.name}" into it? All of ` +
            `"${source.name}"'s transactions will move into "${target.name}", and "${source.name}" will ` +
            'be removed. This cannot be undone.',
        );
        if (!proceed) return;
        void handleMergeCards(source, target);
        return;
      }
      setCards((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
        saveCards(next);
        return next;
      });
    },
    [cards, handleMergeCards],
  );

  const handleDeleteCard = useCallback(
    async (id: string) => {
      const card = cards.find((c) => c.id === id);
      if (!card) return;
      if (cards.length <= 1) return;
      if (!confirm(`Delete "${card.name}" and all of its data? This cannot be undone.`)) return;

      await deleteCardDatabase(card.dbName);
      try {
        localStorage.removeItem(scopedKey(CATEGORY_FILTER_KEY, id));
        localStorage.removeItem(scopedKey(CURRENCY_KEY, id));
        localStorage.removeItem(scopedKey(MONTH_START_KEY, id));
        localStorage.removeItem(scopedKey(WEEK_START_KEY, id));
        localStorage.removeItem(scopedKey(CARD_TYPE_KEY, id));
        localStorage.removeItem(scopedKey(BALANCE_CHECKPOINTS_KEY, id));
      } catch {
        /* ignore */
      }

      const next = cards.filter((c) => c.id !== id);
      setCards(next);
      saveCards(next);
      setCardTypes((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
      setCardCheckpoints((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
      if (id === activeCardId) {
        const fallback = next[0];
        setActiveCardId(fallback.id);
        saveActiveCardId(fallback.id);
        setWizardOpen(false);
      }
      // "Combine all cards" only makes sense (and is only reachable to turn
      // back off) with 2+ cards — dropping to a single one would otherwise
      // strand the app in a combined view with no way back to it via the UI.
      if (next.length <= 1 && combineEnabled) {
        setCombineEnabled(false);
        try {
          localStorage.setItem(COMBINE_KEY, '0');
        } catch {
          /* ignore */
        }
        if (next[0] && next[0].id !== activeCardId) {
          setActiveCardId(next[0].id);
          saveActiveCardId(next[0].id);
        }
      }
      setToast(`Deleted card · ${card.name}`);
    },
    [cards, activeCardId, combineEnabled, setCombineEnabled, setCardTypes, setCardCheckpoints, setWizardOpen, setToast],
  );

  return {
    cards,
    setCards,
    activeCardId,
    setActiveCardId,
    cardManagerOpen,
    setCardManagerOpen,
    cardBusy,
    cardsRef,
    activeCard,
    dbName,
    handleSwitchCard,
    handleCreateCard,
    handleMergeCards,
    handleRenameCard,
    handleDeleteCard,
  };
}
