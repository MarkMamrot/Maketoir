'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Mail, RotateCcw, ShieldCheck } from 'lucide-react';

interface SupplierSignInProps {
  supplier: {
    slug: string;
    displayName: string;
    logoUrl: string | null;
    supportEmail: string | null;
  };
}

export default function SupplierSignIn({ supplier }: SupplierSignInProps) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [logoFailed, setLogoFailed] = useState(false);
  const canRenderLogo = Boolean(supplier.logoUrl)
    && !logoFailed
    && !/^https?:\/\/(?:www\.)?drive\.google\.com\//i.test(supplier.logoUrl ?? '');

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/wholesale/auth/code/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: supplier.slug, email }),
      });
      const data = await response.json();
      if (!response.ok || !data.challengeToken) throw new Error(data.error || 'Unable to send a code.');
      setChallengeToken(data.challengeToken);
      setMessage(data.message || 'Check your email for a six-digit sign-in code.');
      setStep('code');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to send a code.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/wholesale/auth/code/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: supplier.slug, challengeToken, code }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'That code could not be verified.');
      window.location.assign(data.nextRoute || `/wholesale/${supplier.slug}`);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'That code could not be verified.');
    } finally {
      setLoading(false);
    }
  }

  function restart() {
    setStep('email');
    setCode('');
    setChallengeToken('');
    setMessage('');
    setError('');
  }

  return (
    <main className="min-h-screen bg-[#f4f3ef] text-[#18211d]">
      <div className="mx-auto grid min-h-screen max-w-6xl lg:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col justify-between border-b border-[#d8d8d1] px-6 py-8 lg:border-b-0 lg:border-r lg:px-14 lg:py-12">
          <div className="flex items-center gap-4">
            {canRenderLogo ? (
              <img
                src={supplier.logoUrl}
                alt={`${supplier.displayName} logo`}
                onError={() => setLogoFailed(true)}
                className="h-14 w-auto max-w-[220px] object-contain object-left"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[#163f34] font-serif text-xl text-white">
                {supplier.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <span className="text-lg font-semibold">{supplier.displayName}</span>
          </div>

          <div className="max-w-xl py-16 lg:py-24">
            <p className="mb-4 text-xs font-bold uppercase text-[#5b6d65]">Private wholesale ordering</p>
            <h1 className="font-serif text-4xl font-semibold leading-tight sm:text-5xl">
              Your range, orders and account in one place.
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#526059]">
              Sign in with your approved business email. We will send a secure code, so there is no password to remember.
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm text-[#68756f]">
            <ShieldCheck size={18} aria-hidden="true" />
            Products and wholesale pricing are available to approved buyers only.
          </div>
        </section>

        <section className="flex items-center px-6 py-12 lg:px-14">
          <div className="w-full max-w-md">
            {step === 'email' ? (
              <form onSubmit={requestCode}>
                <Mail size={30} className="mb-6 text-[#b55332]" aria-hidden="true" />
                <h2 className="font-serif text-3xl font-semibold">Sign in to order</h2>
                <p className="mt-3 text-sm leading-6 text-[#647069]">
                  Enter the email address approved by {supplier.displayName}.
                </p>
                <label htmlFor="wholesale-email" className="mt-8 block text-sm font-semibold">Business email</label>
                <input
                  id="wholesale-email"
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                  placeholder="buyer@company.com"
                  className="mt-2 h-12 w-full rounded-md border border-[#bfc5bf] bg-white px-3 text-base outline-none focus:border-[#163f34] focus:ring-2 focus:ring-[#163f34]/20"
                />
                {error && <p role="alert" className="mt-4 text-sm text-[#a13928]">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#163f34] px-4 font-semibold text-white hover:bg-[#0e3027] disabled:opacity-60"
                >
                  {loading ? 'Sending code...' : 'Email me a sign-in code'}
                  {!loading && <ArrowRight size={18} aria-hidden="true" />}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyCode}>
                <button type="button" onClick={restart} className="mb-7 flex items-center gap-2 text-sm font-semibold text-[#44534c] hover:text-[#163f34]">
                  <ArrowLeft size={17} aria-hidden="true" /> Change email
                </button>
                <h2 className="font-serif text-3xl font-semibold">Enter your code</h2>
                <p className="mt-3 text-sm leading-6 text-[#647069]">{message}</p>
                <label htmlFor="wholesale-code" className="mt-8 block text-sm font-semibold">Six-digit code</label>
                <input
                  id="wholesale-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoComplete="one-time-code"
                  autoFocus
                  className="mt-2 h-14 w-full rounded-md border border-[#bfc5bf] bg-white px-3 text-center font-mono text-2xl tracking-[0.35em] outline-none focus:border-[#163f34] focus:ring-2 focus:ring-[#163f34]/20"
                />
                {error && <p role="alert" className="mt-4 text-sm text-[#a13928]">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#163f34] px-4 font-semibold text-white hover:bg-[#0e3027] disabled:opacity-60"
                >
                  {loading ? 'Verifying...' : 'Open wholesale portal'}
                  {!loading && <ArrowRight size={18} aria-hidden="true" />}
                </button>
                <button type="button" onClick={() => void requestCode()} disabled={loading} className="mt-5 flex w-full items-center justify-center gap-2 text-sm font-semibold text-[#44534c] hover:text-[#163f34] disabled:opacity-60">
                  <RotateCcw size={16} aria-hidden="true" /> Send another code
                </button>
              </form>
            )}

            <div className="mt-10 border-t border-[#d8d8d1] pt-6 text-sm text-[#68756f]">
              Need access? Contact {supplier.supportEmail ? <a className="font-semibold text-[#163f34] underline" href={`mailto:${supplier.supportEmail}`}>{supplier.supportEmail}</a> : 'your account manager'}.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}