// Shared types for the cloud-sync feature — see syncEngine.ts for the
// orchestration that ties these providers together.

export type ProviderId = 'google' | 'onedrive';

/** One connected cloud account's remote copy of the full backup file. */
export interface CloudProvider {
  id: ProviderId;
  name: string;
  /** True once configured with a Client ID — without one, the provider can't
   *  be connected at all (see config.ts). */
  isConfigured(): boolean;
  /** True once the user has an active, usable session (may still need a
   *  silent token refresh before an actual API call). */
  isConnected(): boolean;
  /** Opens the provider's consent flow. Resolves once connected. */
  connect(): Promise<void>;
  /** Drops the local session. Does not revoke access on the provider's side
   *  (the user can do that from their Google/Microsoft account settings). */
  disconnect(): void;
  /** A short label for the connected account (usually an email), or null if
   *  not connected or unavailable. */
  getAccountLabel(): string | null;
  /** Overwrites the single sync file with `json`. */
  upload(json: string): Promise<void>;
  /** Reads the sync file back, or null if none exists yet. */
  download(): Promise<string | null>;
}

export type SyncPhase = 'idle' | 'syncing' | 'error';

export interface ProviderSyncState {
  connected: boolean;
  accountLabel: string | null;
  lastSyncedAt: number | null;
  phase: SyncPhase;
  lastError: string | null;
}

export interface SyncState {
  google: ProviderSyncState;
  onedrive: ProviderSyncState;
}

export function emptyProviderState(): ProviderSyncState {
  return { connected: false, accountLabel: null, lastSyncedAt: null, phase: 'idle', lastError: null };
}
