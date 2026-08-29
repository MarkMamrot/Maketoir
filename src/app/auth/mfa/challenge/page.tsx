'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { SolvantisMark } from '@/components/SolvantisMark';
import { parseMfaResponse } from '@/lib/auth/mfaResponse';

export default function MfaChallengePage() {
  const router = useRouter();
  const [preauthToken, setPreauthToken] = useState('');
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [rememberBrowser, setRememberBrowser] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = sessionStorage.getItem('mfaPreauthToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    setPreauthToken(token);
  }, [router]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/mfa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preauthToken,
          rememberBrowser,
          ...(mode === 'totp' ? { code } : { recoveryCode: code }),
        }),
      });
      const data = await parseMfaResponse<{ error?: string; nextRoute: string }>(response);
      if (!response.ok) throw new Error(data.error || 'Unable to verify code.');
      sessionStorage.removeItem('mfaPreauthToken');
      router.replace(data.nextRoute);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-black">
      <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center justify-center gap-3">
          <SolvantisMark size={38} title="Solvantis" />
          <h1 className="sv-wordmark text-2xl font-extrabold text-slate-900">Solvantis</h1>
        </div>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <ShieldCheck size={22} />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Verify it&apos;s you</h2>
          <p className="mt-1 text-sm text-gray-500">Enter a code to finish signing in.</p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded border border-gray-200 bg-gray-50 p-1">
          <button type="button" onClick={() => { setMode('totp'); setCode(''); setError(''); }} className={`rounded px-3 py-2 text-sm font-semibold ${mode === 'totp' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}>Authenticator</button>
          <button type="button" onClick={() => { setMode('recovery'); setCode(''); setError(''); }} className={`rounded px-3 py-2 text-sm font-semibold ${mode === 'recovery' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}>Recovery code</button>
        </div>

        <form onSubmit={verify}>
          <label htmlFor="mfa-code" className="flex items-center gap-2 text-xs font-bold uppercase text-gray-600"><KeyRound size={14} /> {mode === 'totp' ? 'Authenticator code' : 'Recovery code'}</label>
          <input
            id="mfa-code"
            value={code}
            onChange={event => setCode(mode === 'totp' ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value.toUpperCase())}
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            autoComplete="one-time-code"
            required
            autoFocus
            placeholder={mode === 'totp' ? '000000' : 'XXXXX-XXXXX-XXXXX-XXXXX'}
            className="mt-2 w-full rounded border border-gray-300 p-3 text-center font-mono text-lg"
          />
          <label className="mt-4 flex items-start gap-3 text-sm text-gray-700">
            <input type="checkbox" checked={rememberBrowser} onChange={event => setRememberBrowser(event.target.checked)} className="mt-0.5 h-4 w-4" />
            Remember this browser for 30 days
          </label>
          {error && <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <button type="submit" disabled={loading || !preauthToken || !code.trim()} className="mt-5 w-full rounded-lg bg-blue-600 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Verifying...' : 'Verify and sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}