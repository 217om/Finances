// Orchestrates the two cloud providers: connect/disconnect, a debounced
// auto-push whenever the app's data changes, manual sync/restore, and a
// small external store (via useSyncExternalStore) so any component can read
// live sync status without threading it through props.
//
// What actually gets synced is deliberately simple: the same full-backup
// JSON already produced for the manual "Download full backup" export (see
// lib/exportData.ts) is pushed as one file per provider on every change, and
// restoring pulls that file through the same additive/merge restore path
// manual backup restore already uses. There's no field-level merge across
// devices — the last push wins for the file's contents, and restoring only
// ever adds to what's local, never deletes — which keeps this honest about
// what it is: an automatic, always-current backup you can pull from another
// device, not real-time multi-device sync.

import { googleDriveProvider } from './googleDrive';
import { oneDriveProvider } from './oneDrive';
import { emptyProviderState, type CloudProvider, type ProviderId, type ProviderSyncState, type SyncState } from './types';

const providers: Record<ProviderId, CloudProvider> = {
  google: googleDriveProvider,
  onedrive: oneDriveProvider,
};

const LAST_SYNCED_KEY = 'cashflow.cloudSync.lastSyncedAt';
const DEBOUNCE_MS = 4000;

function readLastSyncedAt(): Record<ProviderId, number | null> {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_SYNCED_KEY) ?? '{}');
    return {
      google: typeof raw.google === 'number' ? raw.google : null,
      onedrive: typeof raw.onedrive === 'number' ? raw.onedrive : null,
    };
  } catch {
    return { google: null, onedrive: null };
  }
}

function writeLastSyncedAt(next: Record<ProviderId, number | null>): void {
  try {
    localStorage.setItem(LAST_SYNCED_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

class SyncEngine {
  private state: SyncState;
  private listeners = new Set<() => void>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private payloadSource: (() => Promise<string>) | null = null;

  constructor() {
    const lastSyncedAt = readLastSyncedAt();
    this.state = {
      google: {
        ...emptyProviderState(),
        connected: providers.google.isConnected(),
        accountLabel: providers.google.getAccountLabel(),
        lastSyncedAt: lastSyncedAt.google,
      },
      onedrive: {
        ...emptyProviderState(),
        connected: providers.onedrive.isConnected(),
        accountLabel: providers.onedrive.getAccountLabel(),
        lastSyncedAt: lastSyncedAt.onedrive,
      },
    };
  }

  /** Called once by App.tsx so the engine can build the current backup
   *  payload on demand, without needing to know the app's data shape. */
  configurePayloadSource(fn: () => Promise<string>): void {
    this.payloadSource = fn;
  }

  getSnapshot = (): SyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private patch(id: ProviderId, patch: Partial<ProviderSyncState>): void {
    this.state = { ...this.state, [id]: { ...this.state[id], ...patch } };
    for (const l of this.listeners) l();
  }

  isConfigured(id: ProviderId): boolean {
    return providers[id].isConfigured();
  }

  /** Connects a provider, then reports whether it already had a backup file
   *  from a previous device — the caller (Settings UI) can offer to restore
   *  it, since silently pushing local data would otherwise overwrite it.
   *  If the existence check itself fails (e.g. a network blip), that's
   *  reported as "had existing data" too — the safe assumption when we
   *  genuinely don't know, since the alternative (assuming there's nothing
   *  to lose) is exactly the failure mode that can wipe out a real backup. */
  async connect(id: ProviderId): Promise<{ hadExistingData: boolean }> {
    const provider = providers[id];
    await provider.connect();
    this.patch(id, { connected: true, accountLabel: provider.getAccountLabel(), lastError: null });
    let hadExistingData: boolean;
    try {
      hadExistingData = (await provider.download()) !== null;
    } catch {
      hadExistingData = true;
    }
    return { hadExistingData };
  }

  disconnect(id: ProviderId): void {
    providers[id].disconnect();
    const lastSyncedAt = readLastSyncedAt();
    lastSyncedAt[id] = null;
    writeLastSyncedAt(lastSyncedAt);
    this.patch(id, emptyProviderState());
  }

  /** Downloads the given provider's backup file (or null if it has none
   *  yet). Restoring it into the app's own state is the caller's job. */
  async pull(id: ProviderId): Promise<string | null> {
    return providers[id].download();
  }

  private connectedConfiguredProviders(): ProviderId[] {
    return (Object.keys(providers) as ProviderId[]).filter(
      (id) => providers[id].isConfigured() && this.state[id].connected,
    );
  }

  hasAnyConnected(): boolean {
    return this.connectedConfiguredProviders().length > 0;
  }

  /** Pushes the current backup to every connected provider right away. */
  async pushNow(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const targets = this.connectedConfiguredProviders();
    if (targets.length === 0 || !this.payloadSource) return;

    let json: string;
    try {
      json = await this.payloadSource();
    } catch (e) {
      for (const id of targets) this.patch(id, { phase: 'error', lastError: (e as Error).message });
      return;
    }

    await Promise.all(
      targets.map(async (id) => {
        this.patch(id, { phase: 'syncing', lastError: null });
        try {
          await providers[id].upload(json);
          const now = Date.now();
          const lastSyncedAt = readLastSyncedAt();
          lastSyncedAt[id] = now;
          writeLastSyncedAt(lastSyncedAt);
          this.patch(id, { phase: 'idle', lastSyncedAt: now, lastError: null });
        } catch (e) {
          this.patch(id, { phase: 'error', lastError: (e as Error).message || 'Sync failed.' });
        }
      }),
    );
  }

  /** Schedules a push a few seconds out, coalescing bursts of changes (e.g.
   *  importing a statement touches several pieces of state at once) into
   *  one upload instead of one per change. */
  notifyChange(): void {
    if (!this.hasAnyConnected()) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.pushNow();
    }, DEBOUNCE_MS);
  }
}

export const syncEngine = new SyncEngine();
export { providers as cloudProviders };

// A small, harmless debugging hook — useful from the browser console to
// check connection/sync state, and lets end-to-end tests exercise the real
// engine + UI wiring with a swapped-in fake provider instead of needing live
// Google/Microsoft credentials. Exposes no tokens or user data.
if (typeof window !== 'undefined') {
  (window as unknown as { __cashflowSync: unknown }).__cashflowSync = { engine: syncEngine, providers };
}
