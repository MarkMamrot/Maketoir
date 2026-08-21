'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2 } from 'lucide-react';

interface ApplicationProps {
  supplier: { slug: string; displayName: string };
  onBack: () => void;
}

const EMPTY_FORM = {
  companyName: '', contactName: '', email: '', phone: '', abn: '', message: '', acceptedTerms: false,
};

export default function WholesaleApplicationForm({ supplier, onBack }: ApplicationProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function update(field: keyof typeof EMPTY_FORM, value: string | boolean) {
    setForm(current => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/wholesale/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: supplier.slug, application: form }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to submit your application.');
      setSubmitted(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to submit your application.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div>
        <CheckCircle2 size={34} className="mb-6 text-[#28734f]" aria-hidden="true" />
        <h2 className="font-serif text-3xl font-semibold">Check your email</h2>
        <p className="mt-4 text-sm leading-6 text-[#647069]">
          Use the verification link we sent to <strong>{form.email}</strong>. After verification, {supplier.displayName} will review your application.
        </p>
        <button type="button" onClick={onBack} className="mt-8 flex items-center gap-2 text-sm font-semibold text-[#163f34]">
          <ArrowLeft size={17} aria-hidden="true" /> Return to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <button type="button" onClick={onBack} className="mb-7 flex items-center gap-2 text-sm font-semibold text-[#44534c] hover:text-[#163f34]">
        <ArrowLeft size={17} aria-hidden="true" /> Back to sign in
      </button>
      <Building2 size={30} className="mb-5 text-[#b55332]" aria-hidden="true" />
      <h2 className="font-serif text-3xl font-semibold">Apply for wholesale access</h2>
      <p className="mt-3 text-sm leading-6 text-[#647069]">Tell {supplier.displayName} about your business. Approval is completed by their team.</p>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <Field label="Company name" value={form.companyName} onChange={value => update('companyName', value)} autoComplete="organization" required />
        <Field label="Contact name" value={form.contactName} onChange={value => update('contactName', value)} autoComplete="name" required />
        <Field label="Business email" type="email" value={form.email} onChange={value => update('email', value)} autoComplete="email" required />
        <Field label="Phone" type="tel" value={form.phone} onChange={value => update('phone', value)} autoComplete="tel" />
        <Field label="ABN" value={form.abn} onChange={value => update('abn', value)} inputMode="numeric" placeholder="11 digits" />
      </div>

      <label className="mt-5 block text-sm font-semibold" htmlFor="application-message">Message <span className="font-normal text-[#78837d]">(optional)</span></label>
      <textarea
        id="application-message"
        value={form.message}
        onChange={event => update('message', event.target.value)}
        maxLength={2000}
        rows={3}
        className="mt-2 w-full rounded-md border border-[#bfc5bf] bg-white px-3 py-2.5 text-base outline-none focus:border-[#163f34] focus:ring-2 focus:ring-[#163f34]/20"
      />

      <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-5 text-[#526059]">
        <input
          type="checkbox"
          checked={form.acceptedTerms}
          onChange={event => update('acceptedTerms', event.target.checked)}
          required
          className="mt-0.5 h-4 w-4 accent-[#163f34]"
        />
        <span>I confirm these business details are accurate and consent to their use for wholesale account assessment.</span>
      </label>

      {error && <p role="alert" className="mt-4 text-sm text-[#a13928]">{error}</p>}
      <button type="submit" disabled={loading} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#163f34] px-4 font-semibold text-white hover:bg-[#0e3027] disabled:opacity-60">
        {loading ? 'Submitting application...' : 'Submit application'}
        {!loading && <ArrowRight size={18} aria-hidden="true" />}
      </button>
    </form>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: 'numeric';
  placeholder?: string;
}) {
  const id = `application-${props.label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <label className="block text-sm font-semibold" htmlFor={id}>
      {props.label}
      <input
        id={id}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={event => props.onChange(event.target.value)}
        required={props.required}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        className="mt-2 h-11 w-full rounded-md border border-[#bfc5bf] bg-white px-3 text-base font-normal outline-none focus:border-[#163f34] focus:ring-2 focus:ring-[#163f34]/20"
      />
    </label>
  );
}