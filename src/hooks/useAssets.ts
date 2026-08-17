// Free-form assets tracked for net worth (savings accounts, property, loans —
// anything not tied to an imported card). Global state, like budgets:
// extracted out of App.tsx as a self-contained unit, since every handler
// here only ever touches ASSETS_KEY/ASSET_VALUES_KEY and its own state.

import { useCallback, useState } from 'react';
import {
  isValidAssetValues,
  isValidAssets,
  makeAsset,
  makeAssetValueEntry,
  type Asset,
  type AssetKind,
  type AssetValueEntry,
} from '../lib/balances';
import { ASSETS_KEY, ASSET_VALUES_KEY } from '../lib/cards';

export function useAssets() {
  const [assets, setAssets] = useState<Asset[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ASSETS_KEY) ?? '[]');
      return isValidAssets(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [assetValues, setAssetValues] = useState<AssetValueEntry[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ASSET_VALUES_KEY) ?? '[]');
      return isValidAssetValues(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  const handleCreateAsset = useCallback((name: string) => {
    setAssets((prev) => {
      const next = [...prev, makeAsset(name)];
      try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleRenameAsset = useCallback((id: string, name: string) => {
    setAssets((prev) => {
      const trimmed = name.trim();
      const next = trimmed ? prev.map((a) => (a.id === id ? { ...a, name: trimmed, updatedAt: Date.now() } : a)) : prev;
      try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleSetAssetKind = useCallback((id: string, kind: AssetKind) => {
    setAssets((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, kind, updatedAt: Date.now() } : a));
      try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleDeleteAsset = useCallback((id: string) => {
    setAssets((prev) => {
      const next = prev.filter((a) => a.id !== id);
      try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setAssetValues((prev) => {
      const next = prev.filter((v) => v.assetId !== id);
      try {
        localStorage.setItem(ASSET_VALUES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleAddAssetValue = useCallback((assetId: string, date: string, value: number) => {
    setAssetValues((prev) => {
      const next = [...prev, makeAssetValueEntry(assetId, date, value)];
      try {
        localStorage.setItem(ASSET_VALUES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleDeleteAssetValue = useCallback((id: string) => {
    setAssetValues((prev) => {
      const next = prev.filter((v) => v.id !== id);
      try {
        localStorage.setItem(ASSET_VALUES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return {
    assets,
    setAssets,
    assetValues,
    setAssetValues,
    handleCreateAsset,
    handleRenameAsset,
    handleSetAssetKind,
    handleDeleteAsset,
    handleAddAssetValue,
    handleDeleteAssetValue,
  };
}
