import { useSyncState } from '../lib/cloudSync/useSyncState';

export default function EmptyState() {
  const state = useSyncState();
  const cloudSyncActive = state.google.connected || state.onedrive.connected;

  return (
    <section className="empty">
      <h2>See your money, month by month</h2>
      <p>Upload a bank statement to get started. CashFlow keeps building your history as you add more.</p>
      <ol className="steps">
        <li>
          <strong>Export</strong> a CSV or Excel file from your bank.
        </li>
        <li>
          <strong>Drop it in</strong> above. We auto-detect the columns, you just confirm.
        </li>
        <li>
          <strong>Read the trends</strong>: cashflow, income vs. expenses, savings rate, and more.
        </li>
      </ol>
      <p className="empty-note">
        {cloudSyncActive
          ? '☁️ Cloud sync is on — your data also backs up to your connected storage.'
          : '🔒 Nothing is uploaded anywhere. Everything stays in this browser.'}
      </p>
    </section>
  );
}
