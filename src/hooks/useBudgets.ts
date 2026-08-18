// Budgets apply at the total (all-cards-combined) level, not per card —
// global state, independent of which card is active. Extracted out of
// App.tsx as a self-contained unit: every handler here only ever touches
// BUDGETS_KEY/BUDGET_ENTRIES_KEY/BUDGET_CYCLE_AMOUNTS_KEY and its own state,
// never activeCardId or anything card-scoped.

import { useCallback, useState } from 'react';
import {
  deleteBudget,
  isValidBudgetCycleAmounts,
  isValidBudgetEntries,
  isValidBudgets,
  makeBudget,
  renameBudget,
  setBudgetAmount,
  setBudgetCadence,
  setBudgetCycleAmount,
  toggleBudgetCategory,
  type Budget,
  type BudgetCadence,
  type BudgetCycleAmount,
  type BudgetEntry,
} from '../lib/budget';
import { BUDGETS_KEY, BUDGET_CYCLE_AMOUNTS_KEY, BUDGET_ENTRIES_KEY } from '../lib/cards';

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
  const [budgetCycleAmounts, setBudgetCycleAmounts] = useState<BudgetCycleAmount[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BUDGET_CYCLE_AMOUNTS_KEY) ?? '[]');
      return isValidBudgetCycleAmounts(saved) ? saved : [];
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

  const handleSetBudgetCadence = useCallback((id: string, cadence: BudgetCadence) => {
    setBudgets((prev) => {
      const next = setBudgetCadence(prev, id, cadence);
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

  // Marks the budget deleted instead of removing it, so the deletion itself
  // survives a sync merge — see deleteBudget's doc comment in lib/budget.ts.
  const handleDeleteBudget = useCallback((id: string) => {
    setBudgets((prev) => {
      const next = deleteBudget(prev, id);
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
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

  const handleSetBudgetCycleAmount = useCallback((budgetId: string, period: string, amount: number) => {
    setBudgetCycleAmounts((prev) => {
      const next = setBudgetCycleAmount(prev, budgetId, period, amount);
      try {
        localStorage.setItem(BUDGET_CYCLE_AMOUNTS_KEY, JSON.stringify(next));
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
    budgetCycleAmounts,
    setBudgetCycleAmounts,
    handleCreateBudget,
    handleRenameBudget,
    handleSetBudgetCadence,
    handleToggleBudgetCategory,
    handleDeleteBudget,
    handleSetBudgetAmount,
    handleSetBudgetCycleAmount,
  };
}
