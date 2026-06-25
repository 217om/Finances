export default function EmptyState() {
  return (
    <section className="empty">
      <h2>See your money, month by month</h2>
      <p>
        Upload a bank statement to get started. Each month, just add your latest one — CashFlow
        remembers everything you’ve imported and keeps building your history, up to 10 years and
        beyond.
      </p>
      <ol className="steps">
        <li>
          <strong>Export</strong> a CSV or Excel file from your bank (most banks have a “Download
          transactions” option).
        </li>
        <li>
          <strong>Drop it in</strong> above. We auto-detect the date, amount, and description
          columns — you just confirm.
        </li>
        <li>
          <strong>Read the trends</strong>: net cashflow per month, income vs. expenses, savings
          rate, and your best and toughest months.
        </li>
      </ol>
      <p className="empty-note">
        🔒 Nothing is uploaded anywhere. Your statements are parsed and stored only in this browser.
      </p>
    </section>
  );
}
