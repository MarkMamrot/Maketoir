'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SolvantisMark } from '@/components/SolvantisMark';

function ResetForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get('token') ?? '';

  const [password,  setPassword]  = useState('');
  const [confirm,   setConfirm]   = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch('/api/wholesale/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        setLoading(false);
        return;
      }

      router.push('/wholesale/login?reset=1');
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center">
          <p className="text-slate-600 mb-4">This link is invalid or has expired.</p>
          <Link href="/wholesale/forgot-password" className="text-blue-600 hover:underline text-sm">
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <SolvantisMark size={56} variant="tile" className="inline-block mb-4 shadow-lg rounded-2xl" />
          <h1 className="text-2xl font-extrabold text-slate-900">Wholesale Portal</h1>
          <p className="text-sm text-slate-500 mt-1">Set your password</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          <p className="text-sm text-slate-600 mb-5">
            Choose a strong password for your wholesale portal account.
          </p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Minimum 8 characters"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
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
              {loading ? 'Saving…' : 'Set Password & Sign In'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function WholesaleResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
