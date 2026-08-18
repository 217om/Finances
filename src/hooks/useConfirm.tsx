import { useCallback, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

interface ConfirmOptions {
  confirmLabel?: string;
  /** Red/destructive styling by default — pass false for a neutral action
   *  (e.g. "Restore this backup?") that isn't actually destructive. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  message: string;
  resolve: (ok: boolean) => void;
}

/**
 * Promise-based stand-in for window.confirm(), styled to match the rest of
 * the app instead of the browser's native dialog. Drop the returned
 * `confirmDialog` anywhere in the component's JSX, then `await confirm(...)`
 * exactly where a synchronous `confirm(...)` call used to be — everything
 * downstream stays the same since it's still a boolean.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirmAsync = useCallback((message: string, options?: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => setPending({ message, resolve, ...options }));
  }, []);

  const respond = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const confirmDialog = pending ? (
    <ConfirmDialog
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      danger={pending.danger}
      onConfirm={() => respond(true)}
      onCancel={() => respond(false)}
    />
  ) : null;

  return { confirmAsync, confirmDialog };
}
