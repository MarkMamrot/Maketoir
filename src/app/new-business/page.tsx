'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const BUSINESS_TYPES = [
  { value: 'retail', label: 'Retail' },
  { value: 'wholesale', label: 'Wholesale / Distribution' },
  { value: 'hospitality', label: 'Hospitality' },
  { value: 'services', label: 'Services' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'other', label: 'Other' },
];
const LOCATION_BANDS = [
  { value: '1', label: '1 location' },
  { value: '2-5', label: '2–5 locations' },
  { value: '6-20', label: '6–20 locations' },
  { value: '21+', label: '21+ locations' },
];
const CHANNEL_OPTIONS = [
  { value: 'in_store', label: 'In-store / POS' },
  { value: 'online_shop', label: 'Online shop' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'wholesale_b2b', label: 'Wholesale / B2B' },
];
const REVENUE_BANDS = [
  { value: 'under_250k', label: 'Under $250k' },
  { value: '250k_1m', label: '$250k – $1m' },
  { value: '1m_5m', label: '$1m – $5m' },
  { value: '5m_plus', label: '$5m+' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export default function NewBusinessPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [flowType, setFlowType] = useState<'new_user' | 'existing_user' | null>(null);
  const [form, setForm] = useState({
    businessName: '', businessType: '', locationCountBand: '', channels: [] as string[],
    revenueBand: '', country: 'Australia', abn: '', notes: '', contactPhone: '', website: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/business-applications')
      .then(async res => {
        if (res.status === 401) { router.push('/login'); return null; }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        if (data.success && data.application?.status === 'pending_review') {
          router.push('/pending-approval');
          return;
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  useEffect(() => {
    // Distinguish an already-logged-in Admin (existing_user) from a fresh registrant
    // (new_user) purely for copy — the API determines the real flow server-side.
    fetch('/api/user/businesses')
      .then(res => res.ok ? res.json() : null)
      .then(data => setFlowType(data?.success && data.businesses?.length ? 'existing_user' : 'new_user'))
      .catch(() => setFlowType('new_user'));
  }, []);

  const toggleChannel = (value: string) => setForm(prev => ({
    ...prev,
    channels: prev.channels.includes(value) ? prev.channels.filter(c => c !== value) : [...prev.channels, value],
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/business-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Application could not be submitted.');
      } else if (data.flowType === 'existing_user') {
        router.push('/ims?applicationSubmitted=1');
      } else {
        router.push('/pending-approval');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error.');
    }
    setLoading(false);
  };

  if (checking) {
    return <main className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-500">Loading…</main>;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-12 bg-gray-50 text-black">
      <div className="w-full max-w-lg p-8 bg-white shadow-xl rounded-2xl border border-gray-200">
        <h1 className="text-2xl font-extrabold text-blue-600 mb-1 text-center">Tell us about your business</h1>
        <p className="text-sm text-gray-500 mb-6 text-center">
          {flowType === 'existing_user'
            ? 'A few quick details so we can set up your new business.'
            : 'A few quick details so our team can set up your workspace.'}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Business Name *</label>
            <input type="text" required value={form.businessName}
              onChange={e => setForm(p => ({ ...p, businessName: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded mt-1" placeholder="Acme Pty Ltd" />
          </div>

          {flowType === 'new_user' && (
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase">Business Phone</label>
              <input type="tel" value={form.contactPhone}
                onChange={e => setForm(p => ({ ...p, contactPhone: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded mt-1" />
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Business Website (optional)</label>
            <input type="url" value={form.website}
              onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded mt-1" placeholder="https://www.example.com" />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Type of Business *</label>
            <select required value={form.businessType}
              onChange={e => setForm(p => ({ ...p, businessType: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded mt-1 bg-white">
              <option value="" disabled>Select one…</option>
              {BUSINESS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Number of Locations *</label>
            <select required value={form.locationCountBand}
              onChange={e => setForm(p => ({ ...p, locationCountBand: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded mt-1 bg-white">
              <option value="" disabled>Select one…</option>
              {LOCATION_BANDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Sales Channels</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {CHANNEL_OPTIONS.map(c => (
                <label key={c.value} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.channels.includes(c.value)} onChange={() => toggleChannel(c.value)} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Approximate Annual Revenue</label>
            <select value={form.revenueBand}
              onChange={e => setForm(p => ({ ...p, revenueBand: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded mt-1 bg-white">
              <option value="">Prefer not to say</option>
              {REVENUE_BANDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase">Country</label>
              <input type="text" value={form.country}
                onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded mt-1" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 uppercase">ABN (optional)</label>
              <input type="text" value={form.abn}
                onChange={e => setForm(p => ({ ...p, abn: e.target.value }))}
                className="w-full p-2 border border-gray-300 rounded mt-1" />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-600 uppercase">Anything else? (optional)</label>
            <textarea value={form.notes} rows={2}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full p-2 border border-gray-300 rounded mt-1" />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-3 mt-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Submitting…' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  );
}
