'use client';

import Script from 'next/script';
import { CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';

interface TyroInstance {
  init(paySecret: string): Promise<void>;
  createPayForm(): { inject(selector: string): void };
  submitPay(): Promise<void>;
}

declare global {
  interface Window {
    Tyro?: (config: { liveMode: boolean }) => TyroInstance;
  }
}

type CertificationStatus = 'idle' | 'creating' | 'ready' | 'submitting' | 'checking' | 'success' | 'failed';

const styles = {
  surface: { maxWidth: 760, color: '#e2e8f0' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 },
  icon: { width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 8, background: '#0f766e', color: '#fff' },
  heading: { margin: 0, fontSize: 20, letterSpacing: 0 },
  subheading: { margin: '4px 0 0', color: '#94a3b8', fontSize: 13 },
  section: { borderTop: '1px solid rgba(255,255,255,.12)', padding: '20px 0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 },
  label: { display: 'grid', gap: 6, color: '#cbd5e1', fontSize: 12, fontWeight: 700 },
  input: { width: '100%', boxSizing: 'border-box' as const, border: '1px solid rgba(255,255,255,.16)', borderRadius: 6,
    background: '#1e293b', color: '#f8fafc', padding: '10px 11px', fontSize: 14 },
  action: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 40, border: 0,
    borderRadius: 6, background: '#0f766e', color: '#fff', padding: '0 16px', fontWeight: 700, cursor: 'pointer' },
  secondary: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 40,
    border: '1px solid rgba(255,255,255,.18)', borderRadius: 6, background: 'transparent', color: '#e2e8f0',
    padding: '0 14px', fontWeight: 700, cursor: 'pointer' },
  status: { minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, borderLeft: '3px solid #0f766e',
    background: 'rgba(15,118,110,.12)', padding: '10px 12px', color: '#d1fae5', fontSize: 13 },
};

function messageFor(status: CertificationStatus, providerStatus: string): string {
  if (status === 'creating') return 'Creating sandbox Pay Request...';
  if (status === 'ready') return 'Sandbox payment form ready.';
  if (status === 'submitting') return 'Submitting payment to Tyro...';
  if (status === 'checking') return 'Checking the server-confirmed payment status...';
  if (status === 'success') return `Payment status: ${providerStatus || 'SUCCESS'}`;
  if (status === 'failed') return providerStatus ? `Payment status: ${providerStatus}` : 'Payment could not be completed.';
  return 'Sandbox only. No Solvantis order, stock, fulfilment, or accounting record will be created.';
}

export function TyroCertificationView() {
  const [scriptReady, setScriptReady] = useState(false);
  const [amount, setAmount] = useState('1.00');
  const [reference, setReference] = useState('Tyro certification');
  const [descriptor, setDescriptor] = useState('SOLVANTIS TEST');
  const [status, setStatus] = useState<CertificationStatus>('idle');
  const [providerStatus, setProviderStatus] = useState('');
  const [error, setError] = useState('');
  const localRequestId = useRef('');
  const tyro = useRef<TyroInstance | null>(null);

  const refreshStatus = async () => {
    if (!localRequestId.current) return;
    setStatus('checking');
    setError('');
    try {
      const response = await fetch(`/api/admin/tyro/pay-requests?id=${encodeURIComponent(localRequestId.current)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Payment status could not be retrieved.');
      setProviderStatus(String(result.status || ''));
      setStatus(result.status === 'SUCCESS' ? 'success' : ['FAILED', 'VOIDED'].includes(result.status) ? 'failed' : 'ready');
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'Payment status could not be retrieved.');
    }
  };

  const createPayment = async () => {
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      setError('Enter a positive AUD amount.');
      return;
    }
    if (!scriptReady || !window.Tyro) {
      setError('Tyro.js is still loading.');
      return;
    }
    setStatus('creating');
    setProviderStatus('');
    setError('');
    localRequestId.current = '';
    const mount = document.getElementById('tyro-pay-form');
    if (mount) mount.replaceChildren();
    try {
      const response = await fetch('/api/admin/tyro/pay-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents, reference, statementDescriptor: descriptor }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Pay Request could not be created.');
      localRequestId.current = String(result.id);
      const instance = window.Tyro({ liveMode: false });
      await instance.init(String(result.paySecret));
      instance.createPayForm().inject('#tyro-pay-form');
      tyro.current = instance;
      setProviderStatus(String(result.status || 'AWAITING_PAYMENT_INPUT'));
      setStatus('ready');
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'Pay Request could not be created.');
    }
  };

  const submitPayment = async () => {
    if (!tyro.current) return;
    setStatus('submitting');
    setError('');
    try {
      await tyro.current.submitPay();
      await refreshStatus();
    } catch (caught) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'Tyro declined or could not submit the payment.');
    }
  };

  const busy = ['creating', 'submitting', 'checking'].includes(status);

  return (
    <div style={styles.surface}>
      <Script src="https://pay.connect.tyro.com/v1/tyro.js" strategy="afterInteractive"
        onLoad={() => setScriptReady(true)} onReady={() => setScriptReady(true)} />
      <div style={styles.header}>
        <div style={styles.icon}><ShieldCheck size={22} aria-hidden="true" /></div>
        <div>
          <h1 style={styles.heading}>Tyro Pay Certification</h1>
          <p style={styles.subheading}>Pay API sandbox</p>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.grid}>
          <label style={styles.label}>Amount (AUD)
            <input style={styles.input} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} />
          </label>
          <label style={styles.label}>Reference
            <input style={styles.input} maxLength={191} value={reference} onChange={event => setReference(event.target.value)} disabled={busy} />
          </label>
          <label style={styles.label}>Statement descriptor
            <input style={styles.input} maxLength={21} value={descriptor} onChange={event => setDescriptor(event.target.value)} disabled={busy} />
          </label>
        </div>
        <button type="button" style={{ ...styles.action, marginTop: 16, opacity: busy || !scriptReady ? .55 : 1 }}
          onClick={createPayment} disabled={busy || !scriptReady}>
          <CreditCard size={17} aria-hidden="true" /> Create payment
        </button>
      </div>

      <div style={styles.section}>
        <div id="tyro-pay-form" style={{ minHeight: status === 'ready' || status === 'failed' ? 150 : 0 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
          <button type="button" style={{ ...styles.action, opacity: status !== 'ready' || busy ? .55 : 1 }}
            onClick={submitPayment} disabled={status !== 'ready' || busy}>
            <CreditCard size={17} aria-hidden="true" /> Submit payment
          </button>
          <button type="button" style={{ ...styles.secondary, opacity: !localRequestId.current || busy ? .55 : 1 }}
            onClick={refreshStatus} disabled={!localRequestId.current || busy}>
            <RefreshCw size={17} aria-hidden="true" /> Refresh status
          </button>
        </div>
      </div>

      <div role="status" aria-live="polite" style={{ ...styles.status, borderLeftColor: status === 'failed' ? '#ef4444' : '#0f766e' }}>
        {error || messageFor(status, providerStatus)}
      </div>
    </div>
  );
}