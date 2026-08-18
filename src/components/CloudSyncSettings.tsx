import { useState } from 'react';
import { syncEngine } from '../lib/cloudSync/syncEngine';
import { useSyncState } from '../lib/cloudSync/useSyncState';
import type { ProviderId } from '../lib/cloudSync/types';
import { useConfirm } from '../hooks/useConfirm';

interface Props {
  onClose: () => void;
  /** Parses + merges a downloaded backup file into the app, same as manually
   *  restoring a JSON file — owned by App.tsx since it's the one holding all
   *  the state a restore touches. */
  onRestoreFromCloud: (json: string) => Promise<void>;
}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: 'Google Drive',
  onedrive: 'OneDrive',
};

function formatWhen(ms: number | null): string {
  if (ms === null) return 'Never';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Today at ${time}` : `${d.toLocaleDateString()} at ${time}`;
}

function ProviderRow({ id, onRestoreFromCloud }: { id: ProviderId; onRestoreFromCloud: (json: string) => Promise<void> }) {
  const { confirmAsync, confirmDialog } = useConfirm();
  const state = useSyncState()[id];
  const [busy, setBusy] = useState(false);
  const configured = syncEngine.isConfigured(id);

  const handleConnect = async () => {
    setBusy(true);
    try {
      const { hadExistingData } = await syncEngine.connect(id);
      if (!hadExistingData) {
        // Genuinely nothing there yet — safe to create the first backup.
        await syncEngine.pushNow();
        return;
      }
      // There's already a backup out there (or we couldn't confirm either
      // way) — never push blind, since that could silently overwrite real
      // data with whatever's sitting in this browser (e.g. a fresh
      // profile). Only push after the user has actually pulled it down;
      // decline, and this stays connected without uploading anything until
      // a manual "Sync now".
      const wantsRestore = await confirmAsync(
        `${PROVIDER_LABEL[id]} already has a CashFlow backup, probably from another device. Restore it into this browser now? Existing data here is kept either way — matching cards are merged, nothing is deleted.`,
        { confirmLabel: 'Restore', danger: false },
      );
      if (!wantsRestore) return;
      const json = await syncEngine.pull(id);
      if (!json) {
        alert(
          `Connected, but couldn't download the existing backup from ${PROVIDER_LABEL[id]} right now. Nothing has been uploaded — use "Sync now" once you've confirmed what's here is what you want to keep.`,
        );
        return;
      }
      await onRestoreFromCloud(json);
      await syncEngine.pushNow();
    } catch (e) {
      alert(`Could not connect to ${PROVIDER_LABEL[id]}. ${(e as Error).message ?? ''}`.trim());
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      await syncEngine.pushNow();
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (
      !(await confirmAsync(
        `Restore the latest backup from ${PROVIDER_LABEL[id]}? Existing data here is kept, matching cards are merged, nothing is deleted.`,
        { confirmLabel: 'Restore', danger: false },
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      const json = await syncEngine.pull(id);
      if (!json) {
        alert(`No backup found in ${PROVIDER_LABEL[id]} yet.`);
        return;
      }
      await onRestoreFromCloud(json);
    } catch (e) {
      alert(`Could not restore from ${PROVIDER_LABEL[id]}. ${(e as Error).message ?? ''}`.trim());
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (
      !(await confirmAsync(
        `Disconnect ${PROVIDER_LABEL[id]}? This stops future syncing but doesn't delete the backup already there.`,
        { confirmLabel: 'Disconnect', danger: false },
      ))
    ) {
      return;
    }
    syncEngine.disconnect(id);
  };

  return (
    <div className="cloud-provider-row">
      {confirmDialog}
      <div className="cloud-provider-head">
        <span className="cloud-provider-name">{PROVIDER_LABEL[id]}</span>
        {state.connected && <span className="cloud-provider-account muted">{state.accountLabel ?? 'Connected'}</span>}
      </div>

      {!configured ? (
        <p className="muted cloud-provider-note">Not set up yet.</p>
      ) : !state.connected ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleConnect} disabled={busy}>
          {busy ? 'Connecting…' : `Connect ${PROVIDER_LABEL[id]}`}
        </button>
      ) : (
        <>
          <p className="muted cloud-provider-note">
            {state.phase === 'syncing'
              ? 'Syncing…'
              : state.phase === 'error'
                ? `Sync error: ${state.lastError ?? 'unknown'}`
                : `Last synced: ${formatWhen(state.lastSyncedAt)}`}
          </p>
          <div className="cloud-provider-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleSyncNow} disabled={busy}>
              Sync now
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleRestore} disabled={busy}>
              Restore from cloud…
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={handleDisconnect} disabled={busy}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Connect Google Drive and/or OneDrive so every card's full backup (same
 * content as "Download full backup") stays automatically up to date there,
 * and can be pulled onto another device. Not real-time multi-device sync —
 * each push overwrites the provider's copy, and restoring merges it in
 * additively, same as manually restoring a backup file.
 */
export default function CloudSyncSettings({ onClose, onRestoreFromCloud }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="wiz-head">
          <div>
            <h2>Cloud sync</h2>
            <p className="muted">Automatically back up to your own Google Drive or OneDrive.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="cloud-provider-list">
          <ProviderRow id="google" onRestoreFromCloud={onRestoreFromCloud} />
          <ProviderRow id="onedrive" onRestoreFromCloud={onRestoreFromCloud} />
        </div>
      </div>
    </div>
  );
}
