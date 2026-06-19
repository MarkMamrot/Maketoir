'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => router.push('/login'), 3000);
      } else {
        setError(data.error || 'Something went wrong.');
      }
    } catch {
      setError('Unexpected error. Please try again.');
    }
    setLoading(false);
  };

  if (!token) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-12 bg-gray-50 text-black">
        <div className="w-full max-w-md p-8 bg-white shadow-xl rounded-2xl border border-gray-200 text-center">
          <p className="text-red-600 mb-4">Invalid reset link.</p>
          <Link href="/forgot-password" className="text-blue-600 hover:underline font-bold text-sm">Request a new one →</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-12 bg-gray-50 text-black">
      <div className="w-full max-w-md p-8 bg-white shadow-xl rounded-2xl border border-gray-200">
        <h1 className="text-3xl font-extrabold text-blue-600 mb-1 text-center">Solvantis</h1>
        <p className="text-sm text-gray-500 mb-6 text-center">Choose a new password</p>

        {success ? (
          <div className="text-center">
            <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded text-sm">
              Password updated! Redirecting you to sign in…
            </div>
            <Link href="/login" className="text-blue-600 hover:underline text-sm font-bold">Sign In →</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase">New Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                required minLength={8}
                className="w-full p-2 border border-gray-300 rounded mt-1"
                placeholder="Min. 8 characters"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase">Confirm Password</label>
              <input
                type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                required minLength={8}
                className="w-full p-2 border border-gray-300 rounded mt-1"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3 mt-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Updating...' : 'Set New Password'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gray-400">Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
