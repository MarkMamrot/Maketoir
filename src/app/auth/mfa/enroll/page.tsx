'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Download, KeyRound, Loader2 } from 'lucide-react';
import { SolvantisMark } from '@/components/SolvantisMark';
import { parseMfaResponse } from '@/lib/auth/mfaResponse';

type EnrollmentSetup = {
  qrDataUrl: string;
  manualKey: string;
};

export default function MfaEnrollPage() {
  const router = useRouter();
  const [preauthToken, setPreauthToken] = useState('');
  const [setup, setSetup] = useState<EnrollmentSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [nextRoute, setNextRoute] = useState('/ims');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = sessionStorage.getItem('mfaPreauthToken');
    if (!token) {
      router.replace('/login');
      return;
    }
    setPreauthToken(token);
    fetch('/api/auth/mfa/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preauthToken: token }),
    })
      .then(async response => ({
        response,
        data: await parseMfaResponse<EnrollmentSetup & { error?: string }>(response),
      }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || 'Unable to start setup.');
        setSetup({ qrDataUrl: data.qrDataUrl, manualKey: data.manualKey });
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Unable to start setup.'))
      .finally(() => setLoading(false));
  }, [router]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/mfa/enroll/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preauthToken, code }),
      });
      const data = await parseMfaResponse<{
        error?: string;
        recoveryCodes: string[];
        nextRoute: string;
      }>(response);
      if (!response.ok) throw new Error(data.error || 'Unable to verify code.');
      sessionStorage.removeItem('mfaPreauthToken');
      setRecoveryCodes(data.recoveryCodes);
      setNextRoute(data.nextRoute);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify code.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyRecoveryCodes = async () => {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
  };

  const downloadRecoveryCodes = () => {
    if (!recoveryCodes) return;
    const blob = new Blob([
      `Solvantis recovery codes\nGenerated ${new Date().toLocaleString()}\n\n${recoveryCodes.join('\n')}\n`,
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'solvantis-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-black">
      <section className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center justify-center gap-3">
          <SolvantisMark size={38} title="Solvantis" />
          <h1 className="sv-wordmark text-2xl font-extrabold text-slate-900">Solvantis</h1>
        </div>

        {recoveryCodes ? (
          <div>
            <div className="mb-5 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check size={22} />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Authenticator enabled</h2>
              <p className="mt-1 text-sm text-gray-500">Store these one-time recovery codes somewhere secure.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded border border-gray-200 bg-gray-50 p-4 font-mono text-sm">
              {recoveryCodes.map(recoveryCode => <span key={recoveryCode}>{recoveryCode}</span>)}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" onClick={copyRecoveryCodes} className="flex items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50">
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" onClick={downloadRecoveryCodes} className="flex items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50">
                <Download size={16} /> Download
              </button>
            </div>
            <label className="mt-5 flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4" />
              I have stored my recovery codes securely.
            </label>
            <button type="button" disabled={!acknowledged} onClick={() => router.replace(nextRoute)} className="mt-5 w-full rounded-lg bg-blue-600 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              Continue
            </button>
          </div>
        ) : (
          <div>
            <div className="mb-5 text-center">
              <h2 className="text-xl font-bold text-slate-900">Secure your account</h2>
              <p className="mt-1 text-sm text-gray-500">Add Solvantis to your authenticator app, then enter its six-digit code.</p>
            </div>
            {loading && <div className="flex h-72 items-center justify-center text-gray-500"><Loader2 className="animate-spin" size={26} /></div>}
            {setup && (
              <form onSubmit={verify}>
                <img src={setup.qrDataUrl} alt="Authenticator setup QR code" width={280} height={280} className="mx-auto h-64 w-64" />
                <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-gray-500"><KeyRound size={14} /> Manual key</div>
                  <div className="break-all font-mono text-sm text-slate-800">{setup.manualKey}</div>
                </div>
                <label htmlFor="mfa-enroll-code" className="mt-5 block text-xs font-bold uppercase text-gray-600">Authenticator code</label>
                <input id="mfa-enroll-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} autoFocus className="mt-1 w-full rounded border border-gray-300 p-3 text-center font-mono text-2xl tracking-widest" />
                <button type="submit" disabled={submitting || code.length !== 6} className="mt-4 w-full rounded-lg bg-blue-600 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                  {submitting ? 'Verifying...' : 'Enable authenticator'}
                </button>
              </form>
            )}
            {error && <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          </div>
        )}
      </section>
    </main>
  );
}