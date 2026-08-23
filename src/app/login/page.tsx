'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { SolvantisMark } from '@/components/SolvantisMark';

const DESTINATIONS = [
  { key: 'ims',       label: 'IMS',       desc: 'Inventory Management',  path: '/ims',       icon: '📦' },
  { key: 'foresight', label: 'Foresight',  desc: 'Analytics & Marketing', path: '/dashboard', icon: '📊' },
  { key: 'pos',       label: 'POS',        desc: 'Point of Sale',         path: '/pos',       icon: '🛒' },
];

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const justRegistered = searchParams.get('registered') === '1';
  const justInvited = searchParams.get('invited') === '1';

  const [destination, setDestination] = useState('ims');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, destination }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.requiresMfa && typeof data.preauthToken === 'string') {
          sessionStorage.setItem('mfaPreauthToken', data.preauthToken);
          router.push(data.nextRoute);
          return;
        }
        router.push(data.nextRoute);
      } else {
        setError(data.error || 'Login failed.');
      }
    } catch (err: any) {
      setError(err.message || 'Unexpected error.');
    }
    setLoading(false);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-black">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center opacity-50"
        style={{ backgroundImage: "url('/login/LoginBackdrop.jpg')" }}
      />
      <div aria-hidden="true" className="absolute inset-0 bg-slate-950/20" />

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-7xl items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_30rem] lg:gap-20 lg:px-12">
        <section className="max-w-2xl pt-6 text-white lg:pt-0">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">Solvantis</p>
          <h1 className="text-3xl font-black leading-[1.05] text-white sm:text-5xl lg:text-7xl">
            The Operating System
            <span className="mt-2 block text-cyan-300">For Modern Commerce.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-slate-200 sm:text-lg">
            Advanced Inventory, POS, Automation, Wholesale Tools, analytics, and CRM, unified in one platform built for the way modern retailers and wholesalers work.
          </p>
        </section>

        <div className="w-full rounded-lg border border-white/60 bg-white/95 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <div className="mb-1 flex items-center justify-center gap-3">
          <SolvantisMark size={38} title="Solvantis" />
          <h1 className="sv-wordmark text-2xl font-extrabold text-slate-900">Solvantis</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6 text-center">Sign in to your workspace</p>

        {justRegistered && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded text-sm text-center">
            Business account created! Sign in below.
          </div>
        )}
        {justInvited && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded text-sm text-center">
            Account created! Sign in below.
          </div>
        )}

        {/* Destination selector */}
        <div className="mb-5">
          <label className="text-xs font-bold text-gray-600 uppercase block mb-2">Sign in to</label>
          <div className="grid grid-cols-3 gap-2">
            {DESTINATIONS.map(d => (
              <button key={d.key} type="button" onClick={() => setDestination(d.key)}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-sm font-semibold
                  ${destination === d.key
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
                <span className="text-xl">{d.icon}</span>
                <span>{d.label}</span>
                <span className="text-xs font-normal text-gray-400">{d.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label htmlFor="login-email" className="text-xs font-bold text-gray-600 uppercase">Email Address</label>
            <input
              id="login-email"
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-xs font-bold text-gray-600 uppercase">Password</label>
            <input
              id="login-password"
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
            <div className="text-right mt-1">
              <Link href="/forgot-password" className="text-xs text-blue-500 hover:underline">Forgot your password?</Link>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
          )}

          <button type="submit" disabled={loading}
            className="mt-2 w-full rounded-md bg-blue-600 py-3 font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Authenticating...' : `Sign in to ${DESTINATIONS.find(d => d.key === destination)?.label}`}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-gray-600">
          <p>Don&apos;t have an account? <Link href="/register" className="text-blue-600 hover:underline font-bold">Register Now</Link></p>
        </div>
      </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gray-400">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
