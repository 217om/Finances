// Budgets apply at the total (all-cards-combined) level, not per card —
// global state, independent of which card is active. Extracted out of
// App.tsx as a self-contained unit: every handler here only ever touches
// BUDGETS_KEY/BUDGET_ENTRIES_KEY and its own state, never activeCardId or
// anything card-scoped.

import { useCallback, useState } from 'react';
import {
  isValidBudgetEntries,
  isValidBudgets,
  makeBudget,
  removeBudgetEntries,
  renameBudget,
  setBudgetAmount,
  setBudgetAmountForWeeks,
  toggleBudgetCategory,
  type Budget,
  type BudgetEntry,
} from '../lib/budget';
import { BUDGETS_KEY, BUDGET_ENTRIES_KEY } from '../lib/cards';

export function useBudgets() {
  const [budgets, setBudgets] = useState<Budget[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BUDGETS_KEY) ?? '[]');
      return isValidBudgets(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BUDGET_ENTRIES_KEY) ?? '[]');
      return isValidBudgetEntries(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  const handleCreateBudget = useCallback((name: string) => {
    setBudgets((prev) => {
      const next = [...prev, makeBudget(name)];
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleRenameBudget = useCallback((id: string, name: string) => {
    setBudgets((prev) => {
      const next = renameBudget(prev, id, name);
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleToggleBudgetCategory = useCallback((id: string, category: string) => {
    setBudgets((prev) => {
      const next = toggleBudgetCategory(prev, id, category);
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleDeleteBudget = useCallback((id: string) => {
    setBudgets((prev) => {
      const next = prev.filter((b) => b.id !== id);
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setBudgetEntries((prev) => {
      const next = removeBudgetEntries(prev, id);
      try {
        localStorage.setItem(BUDGET_ENTRIES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleSetBudgetAmount = useCallback((budgetId: string, weekStart: string, amount: number) => {
    setBudgetEntries((prev) => {
      const next = setBudgetAmount(prev, budgetId, weekStart, amount);
      try {
        localStorage.setItem(BUDGET_ENTRIES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleSetBudgetAmountForWeeks = useCallback((budgetId: string, weekStarts: string[], amount: number) => {
    setBudgetEntries((prev) => {
      const next = setBudgetAmountForWeeks(prev, budgetId, weekStarts, amount);
      try {
        localStorage.setItem(BUDGET_ENTRIES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return {
    budgets,
    setBudgets,
    budgetEntries,
    setBudgetEntries,
    handleCreateBudget,
    handleRenameBudget,
    handleToggleBudgetCategory,
    handleDeleteBudget,
    handleSetBudgetAmount,
    handleSetBudgetAmountForWeeks,
  };
}
