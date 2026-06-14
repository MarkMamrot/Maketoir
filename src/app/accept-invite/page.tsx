'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [invite, setInvite] = useState<{ email: string; businessName: string; role: string } | null>(null);
  const [tokenError, setTokenError] = useState('');
  const [form, setForm] = useState({ name: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setTokenError('No invite token found in this URL.'); return; }
    fetch(`/api/auth/accept-invite?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setInvite(data);
        else setTokenError(data.error || 'Invalid invite link.');
      })
      .catch(() => setTokenError('Could not validate invite link.'));
  }, [token]);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: form.name, password: form.password }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to create account.');
      } else {
        router.push('/login?invited=1');
      }
    } catch (err: any) {
      setError(err.message || 'Unexpected error.');
    }
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-12 bg-gray-50 text-black">
      <div className="w-full max-w-md p-8 bg-white shadow-xl rounded-2xl border border-gray-200">
        <h1 className="text-3xl font-extrabold text-blue-600 mb-1 text-center">Solvantis</h1>

        {tokenError ? (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded text-sm text-center">
            <p className="font-bold mb-1">Invite link problem</p>
            <p>{tokenError}</p>
            <Link href="/login" className="mt-4 inline-block text-blue-600 hover:underline text-sm">Go to Login</Link>
          </div>
        ) : !invite ? (
          <p className="text-center text-gray-400 mt-6">Validating invite...</p>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-1 text-center">You've been invited to join</p>
            <p className="text-center font-bold text-gray-800 mb-6">{invite.businessName}</p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase">Email</label>
                <input type="email" value={invite.email} disabled
                  className="w-full p-2 border border-gray-200 bg-gray-50 rounded mt-1 text-gray-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase">Your Name</label>
                <input type="text" value={form.name} onChange={set('name')}
                  className="w-full p-2 border border-gray-300 rounded mt-1" placeholder="Jane Smith" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase">Password *</label>
                <input type="password" value={form.password} onChange={set('password')} required minLength={8}
                  className="w-full p-2 border border-gray-300 rounded mt-1" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 uppercase">Confirm Password *</label>
                <input type="password" value={form.confirm} onChange={set('confirm')} required
                  className="w-full p-2 border border-gray-300 rounded mt-1" />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
              )}

              <button type="submit" disabled={loading}
                className="w-full py-3 mt-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Creating account...' : 'Accept Invite & Create Account'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gray-400">Loading...</div>}>
      <AcceptInviteForm />
    </Suspense>
  );
}
