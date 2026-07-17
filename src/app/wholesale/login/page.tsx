'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const resetDone    = searchParams.get('reset') === '1';

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [setupSent, setSetupSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSetupSent(false);

    try {
      const res  = await fetch('/api/wholesale/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (data.needsPasswordSetup) {
        setSetupSent(true);
        setLoading(false);
        return;
      }

      if (!res.ok || !data.success) {
        setError(data.error || 'Login failed.');
        setLoading(false);
        return;
      }

      router.push('/wholesale');
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 2L24 7.5V20.5L14 26L4 20.5V7.5L14 2Z" fill="white" fillOpacity="0.15" stroke="white" strokeWidth="1.5"/>
              <path d="M16.5 8H12L10.5 14H13.5L11.5 20L19 12.5H15L16.5 8Z" fill="white"/>
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">Wholesale Portal</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          {resetDone && (
            <div className="mb-5 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm text-center">
              Password updated successfully. You can now sign in.
            </div>
          )}

          {setupSent ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-full mb-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-800 mb-2">Check your inbox</h2>
              <p className="text-sm text-slate-500 mb-4">
                We&apos;ve sent a password setup link to <strong>{email}</strong>.
                Please check your email and click the link to set your password.
              </p>
              <button
                type="button"
                onClick={() => setSetupSent(false)}
                className="text-sm text-blue-600 hover:underline"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="you@company.com"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="••••••••"
                />
                <div className="text-right mt-1.5">
                  <Link href="/wholesale/forgot-password" className="text-xs text-blue-600 hover:underline">
                    Forgot your password?
                  </Link>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Having trouble? Contact your account manager.
        </p>
      </div>
    </main>
  );
}

export default function WholesaleLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
