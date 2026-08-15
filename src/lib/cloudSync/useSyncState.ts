import { useSyncExternalStore } from 'react';
import { syncEngine } from './syncEngine';
import type { SyncState } from './types';

/** Live sync status for both providers — re-renders the caller whenever
 *  either provider's connection or sync phase changes. */
export function useSyncState(): SyncState {
  return useSyncExternalStore(syncEngine.subscribe, syncEngine.getSnapshot);
}
