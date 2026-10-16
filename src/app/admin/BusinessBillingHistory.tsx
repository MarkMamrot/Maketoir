'use client';

import { useState } from 'react';
import { businessBillingMonths, currentBillingMonth, type BusinessBillingEntry } from '@/lib/admin/businessBilling';
import styles from './BusinessSettings.module.css';

export function BusinessBillingHistory({ planStartDate, entries, onChange, disabled }: {
  planStartDate: string | null;
  entries: BusinessBillingEntry[];
  onChange: (entry: BusinessBillingEntry) => void;
  disabled: boolean;
}) {
  const months = businessBillingMonths(planStartDate, entries);
  const years = [...new Set(months.map(month => month.slice(0, 4)))].sort().reverse();
  const [selectedYear, setSelectedYear] = useState(currentBillingMonth().slice(0, 4));
  const year = years.includes(selectedYear) ? selectedYear : years[0] ?? selectedYear;
  const byMonth = new Map(entries.map(entry => [entry.month, entry]));
  return <section aria-label="Monthly payment history">
    <div className={styles.historyHeading}>
      <div><h3>Monthly payment history</h3><p>Manually record the agreed plan, amount in AUD and paid status. Nothing here charges the business or creates an invoice.</p></div>
      <label className={styles.year}>Year
        <select aria-label="History year" value={year} disabled={disabled || !years.length} onChange={event => setSelectedYear(event.target.value)}>
          {!years.length && <option value={year}>{year}</option>}
          {years.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </div>
    {!planStartDate && <p className={styles.notice}>Set a plan start date in Plan &amp; Billing to list active calendar months. Previously recorded history is retained.</p>}
    <div className={styles.months}>
      {months.filter(month => month.startsWith(`${year}-`)).map(month => {
        const saved = byMonth.get(month);
        const entry = saved ?? { month, paymentPlan: '', amountAud: '', paid: false, revision: 0 };
        const monthName = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
        return <fieldset key={month} className={styles.month} disabled={disabled}>
          <legend>{monthName}</legend>
          <div className={styles.monthStatus}>{!saved ? 'Not recorded' : saved.paid ? 'Paid' : 'Unpaid'}{saved?.revision === 0 && ' · Unsaved'}</div>
          <div className={styles.monthFields}>
            <label>Payment plan<input aria-label={`Payment plan for ${monthName}`} value={entry.paymentPlan} maxLength={120}
              onChange={event => onChange({ ...entry, paymentPlan: event.target.value })} placeholder="Enter agreed plan" /></label>
            <label>Amount (AUD)<input aria-label={`Amount for ${monthName}`} type="text" inputMode="decimal" value={entry.amountAud}
              onChange={event => onChange({ ...entry, amountAud: event.target.value })} placeholder="Not recorded" /></label>
            <label className={styles.check}><input type="checkbox" aria-label={`Paid for ${monthName}`} checked={entry.paid}
              onChange={event => onChange({ ...entry, paid: event.target.checked })} />Paid</label>
          </div>
        </fieldset>;
      })}
    </div>
    {!months.length && <p>No monthly history yet. Months through the current Australian calendar month appear once the plan starts.</p>}
  </section>;
}
