'use client';

import { FormEvent, useRef, useState } from 'react';
import { Check, Mail, Phone } from 'lucide-react';

type PreferredContact = 'email' | 'phone' | 'sms';

interface LeadFormState {
  name: string;
  company: string;
  email: string;
  phone: string;
  preferredContact: PreferredContact;
  consent: boolean;
  locations: string;
  currentSystems: string;
  timeframe: string;
}

const initialForm: LeadFormState = {
  name: '', company: '', email: '', phone: '', preferredContact: 'email', consent: false,
  locations: '', currentSystems: '', timeframe: '',
};

function mailtoHref(form: LeadFormState): string {
  const subject = encodeURIComponent(`Sales enquiry - ${form.company || form.name || 'Solvantis website'}`);
  const body = encodeURIComponent([
    'Hi Solvantis Sales,', '', 'I could not send the website form. Please contact me about Solvantis.', '',
    `Name: ${form.name}`, `Company: ${form.company || 'Not provided'}`,
    `Email: ${form.email || 'Not provided'}`, `Phone: ${form.phone || 'Not provided'}`,
    `Preferred contact: ${form.preferredContact}`, `Locations: ${form.locations || 'Not provided'}`,
    `Current systems / interest: ${form.currentSystems || 'Not provided'}`,
    `Timeframe: ${form.timeframe || 'Not provided'}`,
  ].join('\n'));
  return `mailto:sales@solvantis.com?subject=${subject}&body=${body}`;
}

export function ProspectLeadForm({
  conversationId = null,
  sourcePath,
  compact = false,
  onSuccess,
}: {
  conversationId?: string | null;
  sourcePath: string;
  compact?: boolean;
  onSuccess?: (reference: string) => void;
}) {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const idempotencyKey = useRef(crypto.randomUUID());

  const setField = <Key extends keyof LeadFormState>(key: Key, value: LeadFormState[Key]) => {
    setForm(previous => ({ ...previous, [key]: value }));
    setError('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');

    const payload = {
      idempotencyKey: idempotencyKey.current,
      conversationId,
      name: form.name.trim(),
      company: form.company.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      preferredContact: form.preferredContact,
      consentEmail: form.preferredContact === 'email' && form.consent,
      consentPhone: form.preferredContact === 'phone' && form.consent,
      consentSms: form.preferredContact === 'sms' && form.consent,
      locations: form.locations.trim() || null,
      currentSystems: form.currentSystems.trim() || null,
      timeframe: form.timeframe.trim() || null,
      sourcePath,
    };

    try {
      const response = await fetch('/api/public/sales-assistant/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'We could not send your request.');
      const nextReference = String(data.reference || data.publicReference || data.leadId || 'received');
      setReference(nextReference);
      onSuccess?.(nextReference);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'We could not send your request.');
    } finally {
      setSubmitting(false);
    }
  };

  if (reference) {
    return (
      <div className="py-8 text-center" role="status">
        <span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Check size={22} /></span>
        <h3 className="text-lg font-bold text-slate-900">Thanks, your request is with our sales team.</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">We&apos;ll respond through your chosen channel within one business day.</p>
        {reference !== 'received' && <p className="mt-3 text-xs font-semibold text-slate-500">Reference {reference}</p>}
      </div>
    );
  }

  const consentLabel = form.preferredContact === 'email'
    ? 'I agree to receive a personal reply by email about this enquiry.'
    : form.preferredContact === 'phone'
      ? 'I agree to receive a phone call about this enquiry.'
      : 'I agree to receive an SMS reply about this enquiry.';

  return (
    <form onSubmit={submit} className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">
          Full name *
          <input required autoComplete="name" value={form.name} onChange={event => setField('name', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500" />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Company / store
          <input autoComplete="organization" value={form.company} onChange={event => setField('company', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500" />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-slate-700">How should we contact you? *</legend>
        <div className="grid grid-cols-3 gap-2">
          {(['email', 'phone', 'sms'] as const).map(channel => (
            <label key={channel} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold ${form.preferredContact === channel ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600'}`}>
              <input className="sr-only" type="radio" name="preferredContact" value={channel} checked={form.preferredContact === channel} onChange={() => { setField('preferredContact', channel); setField('consent', false); }} />
              {channel === 'email' ? <Mail size={14} /> : <Phone size={14} />} {channel === 'sms' ? 'SMS' : channel[0].toUpperCase() + channel.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">
          Work email {form.preferredContact === 'email' ? '*' : ''}
          <input required={form.preferredContact === 'email'} type="email" autoComplete="email" value={form.email} onChange={event => setField('email', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500" />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Phone {form.preferredContact !== 'email' ? '*' : ''}
          <input required={form.preferredContact !== 'email'} type="tel" autoComplete="tel" value={form.phone} onChange={event => setField('phone', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-normal text-slate-900 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500" />
        </label>
      </div>

      <details className="border-t border-slate-200 pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-blue-700">Add details to tailor the conversation</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Locations<input value={form.locations} onChange={event => setField('locations', event.target.value)} placeholder="e.g. 4 stores" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-blue-500" /></label>
          <label className="text-xs font-semibold text-slate-700">Timeframe<input value={form.timeframe} onChange={event => setField('timeframe', event.target.value)} placeholder="e.g. next 3 months" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-blue-500" /></label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Current systems or what you&apos;d like to discuss<textarea rows={2} value={form.currentSystems} onChange={event => setField('currentSystems', event.target.value)} className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-blue-500" /></label>
        </div>
      </details>

      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-slate-600">
        <input required type="checkbox" checked={form.consent} onChange={event => setField('consent', event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
        <span>{consentLabel}</span>
      </label>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800" role="alert">
          {error} <a className="font-bold underline" href={mailtoHref(form)}>Email sales instead</a>
        </div>
      )}
      <button disabled={submitting || !form.consent} type="submit" className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
        {submitting ? 'Sending...' : 'Send request'}
      </button>
      <p className="text-center text-[11px] leading-relaxed text-slate-500">Your details are used only to respond to this enquiry. Consent is specific to the channel selected above.</p>
    </form>
  );
}