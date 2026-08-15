import { useSyncState } from '../lib/cloudSync/useSyncState';

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/** A small status pill in the header showing whether a cloud-connected
 *  backup is syncing, up to date, or failed — silent (renders nothing) until
 *  at least one provider is actually connected, so it stays out of the way
 *  for anyone not using cloud sync. */
export default function SyncStatusBadge() {
  const state = useSyncState();
  const connected = (['google', 'onedrive'] as const).filter((id) => state[id].connected);
  if (connected.length === 0) return null;

  const syncing = connected.some((id) => state[id].phase === 'syncing');
  const errored = connected.filter((id) => state[id].phase === 'error');
  const lastSyncedAt = connected.reduce<number | null>((latest, id) => {
    const t = state[id].lastSyncedAt;
    if (t === null) return latest;
    return latest === null || t > latest ? t : latest;
  }, null);

  if (syncing) {
    return (
      <span className="sync-badge sync-badge-active" title="Syncing your data to the cloud">
        <span className="sync-spinner" aria-hidden />
        Syncing…
      </span>
    );
  }

  if (errored.length > 0) {
    const titles = errored.map((id) => `${state[id].phase === 'error' ? state[id].lastError ?? 'Sync failed.' : ''}`);
    return (
      <span className="sync-badge sync-badge-error" title={titles.join(' ') || 'Sync failed.'}>
        <span className="sync-dot sync-dot-error" aria-hidden />
        Sync error
      </span>
    );
  }

  return (
    <span className="sync-badge" title="Automatically backed up to your connected cloud storage">
      <span className="sync-dot sync-dot-ok" aria-hidden />
      Synced {lastSyncedAt ? relativeTime(lastSyncedAt) : ''}
    </span>
  );
}
