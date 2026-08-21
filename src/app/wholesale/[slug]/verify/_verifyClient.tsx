'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleAlert, MailCheck } from 'lucide-react';

export default function VerifyApplicationEmail({ slug, token, supplierName }: { slug: string; token: string; supplierName: string }) {
  const [state, setState] = useState<'ready' | 'loading' | 'success' | 'error'>('ready');
  const [message, setMessage] = useState('');

  async function verify() {
    setState('loading');
    const response = await fetch('/api/wholesale/applications/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, token }),
    });
    const data = await response.json();
    setMessage(data.message || data.error || 'Email verification failed.');
    setState(response.ok && data.success ? 'success' : 'error');
  }

  const Icon = state === 'success' ? CheckCircle2 : state === 'error' ? CircleAlert : MailCheck;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f3ef] px-5 py-12 text-[#18211d]">
      <section className="w-full max-w-lg border border-[#d8d8d1] bg-white p-8 sm:p-10">
        <Icon size={36} className={`mb-6 ${state === 'error' ? 'text-[#a13928]' : 'text-[#28734f]'}`} aria-hidden="true" />
        <h1 className="font-serif text-3xl font-semibold">{state === 'success' ? 'Email verified' : 'Verify your email'}</h1>
        <p className="mt-4 text-sm leading-6 text-[#647069]">
          {message || `Confirm your email address to send your application to ${supplierName} for review.`}
        </p>
        {state === 'ready' && (
          <button type="button" onClick={() => void verify()} className="mt-7 h-12 w-full rounded-md bg-[#163f34] px-4 font-semibold text-white hover:bg-[#0e3027]">
            Verify email address
          </button>
        )}
        {state === 'loading' && <p className="mt-7 text-sm font-semibold">Verifying...</p>}
        {(state === 'success' || state === 'error') && (
          <Link href={`/wholesale/${slug}`} className="mt-7 inline-block text-sm font-semibold text-[#163f34] underline">Return to {supplierName}</Link>
        )}
      </section>
    </main>
  );
}