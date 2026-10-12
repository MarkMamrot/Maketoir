'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import styles from '../syncbooks.module.css';

export function ConsultationForm() {
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const fields = Object.fromEntries(new FormData(form));
    const payload = JSON.stringify({ ...fields, consentEmail: fields.consentEmail === 'on' });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    setPending(true); setError('');
    try {
      const response = await fetch('/api/public/syncbooks/enquiry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current!.key }, body: payload });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Your enquiry could not be saved. Please try again.');
      if (typeof data.reference !== 'string' || !/^SL-\d+$/.test(data.reference)) throw new Error('Receipt could not be confirmed. Please retry.');
      setReference(data.reference);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to connect. Please try again.');
    } finally { setPending(false); }
  }

  if (reference) return <div className={styles.formSuccess} role="status"><CheckCircle2 size={38} /><h3>Thanks, we have the brief.</h3><p>Your enquiry has been saved. The team will follow up by email about your consultation.</p><p>Reference: <strong>{reference}</strong></p></div>;

  return <form className={styles.form} onSubmit={handleSubmit}>
    <fieldset disabled={pending}>
      <div className={styles.fieldRow}>
        <label>Your name<input name="name" required maxLength={255} autoComplete="name" /></label>
        <label>Work email<input name="email" type="email" required maxLength={320} autoComplete="email" /></label>
      </div>
      <div className={styles.fieldRow}>
        <label>Business name<input name="business" required maxLength={255} autoComplete="organization" /></label>
        <label>Team size<select name="employees" defaultValue=""><option value="">Select a range</option><option>1-5 employees</option><option>6-15 employees</option><option>16-35 employees</option><option>35+ employees</option></select></label>
      </div>
      <div className={styles.fieldRow}>
        <label>Current software<select name="software" defaultValue=""><option value="">Not sure / other</option>{['Xero', 'QuickBooks', 'MYOB', 'Cin7', 'Lightspeed', 'Solvantis'].map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Preferred support<select name="delivery" defaultValue=""><option value="">Open to advice</option><option>Local</option><option>Overseas</option><option>Blended</option></select></label>
      </div>
      <label>What would you like help with?<textarea name="needs" rows={4} maxLength={3000} placeholder="For example: weekly bookkeeping, payroll and catching up two months of reconciliations..." /></label>
      <div className={styles.honeypot} aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className={styles.consent}><input name="consentEmail" type="checkbox" required /><span>I agree that the Solvantis team may email me about this SyncBooks enquiry. This is not marketing consent. <a href="/privacy">Privacy policy</a></span></label>
      <p className={styles.formNote}>Your contact details and brief are stored by Solvantis and shared with the team handling your enquiry. We will discuss delivery preferences before agreeing service arrangements. Do not include passwords or financial records.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.button} type="submit">{pending ? 'Saving enquiry...' : 'Request my consultation'} <ArrowRight size={18} /></button>
    </fieldset>
  </form>;
}