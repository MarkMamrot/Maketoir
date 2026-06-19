'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';

function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Something went wrong.');
      }
    } catch {
      setError('Unexpected error. Please try again.');
    }
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-12 bg-gray-50 text-black">
      <div className="w-full max-w-md p-8 bg-white shadow-xl rounded-2xl border border-gray-200">
        <h1 className="text-3xl font-extrabold text-blue-600 mb-1 text-center">Solvantis</h1>
        <p className="text-sm text-gray-500 mb-6 text-center">Reset your password</p>

        {submitted ? (
          <div className="text-center">
            <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded text-sm">
              If an account exists for <strong>{email}</strong>, you&apos;ll receive a reset link shortly. Check your inbox (and spam folder).
            </div>
            <Link href="/login" className="text-blue-600 hover:underline text-sm font-bold">← Back to Sign In</Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-6">Enter your email address and we&apos;ll send you a link to reset your password.</p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase">Email Address</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  className="w-full p-2 border border-gray-300 rounded mt-1"
                  placeholder="you@example.com"
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
              )}

              <button type="submit" disabled={loading}
                className="w-full py-3 mt-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
            <div className="mt-6 text-center text-sm">
              <Link href="/login" className="text-blue-600 hover:underline font-bold">← Back to Sign In</Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gray-400">Loading...</div>}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
