'use client';

import { Gift, Plus, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { LoyaltyReward } from '@/lib/loyalty/types';

type RewardDraft = Omit<LoyaltyReward, 'businessId'>;

const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 9px', boxSizing: 'border-box', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 6, color: 'var(--sv-text-main)', fontSize: 13 };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 5, color: 'var(--sv-text-dim)', fontSize: 12, fontWeight: 600 };

function blankReward(sortOrder: number): RewardDraft {
  return { id: 0, rewardCode: '', displayName: '', description: '', pointsCost: 100, valueAud: 5, isActive: true, sortOrder };
}

export function LoyaltyRewardsSettings() {
  const [rewards, setRewards] = useState<RewardDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    void fetch('/api/ims/loyalty/rewards').then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Rewards could not be loaded.');
      setRewards(body.rewards);
    }).catch(error => setMessage({ error: true, text: error instanceof Error ? error.message : 'Rewards could not be loaded.' })).finally(() => setLoading(false));
  }, []);

  const change = <K extends keyof RewardDraft>(index: number, key: K, value: RewardDraft[K]) => {
    setRewards(previous => previous.map((reward, rewardIndex) => rewardIndex === index ? { ...reward, [key]: value } : reward));
    setMessage(null);
  };

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch('/api/ims/loyalty/rewards', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rewards }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Rewards could not be saved.');
      setRewards(body.rewards);
      setMessage({ error: false, text: 'Reward settings saved.' });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Rewards could not be saved.' });
    } finally { setSaving(false); }
  };

  return <section style={{ marginTop: 16, padding: 20, background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
      <div><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)' }}><Gift size={16} />Rewards</div><div style={{ marginTop: 3, fontSize: 12, color: 'var(--sv-text-dim)' }}>Fixed-dollar rewards available at POS and for Shopify discount conversion.</div></div>
      <button type="button" onClick={() => setRewards(previous => [...previous, blankReward(previous.length)])} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', cursor: 'pointer', fontWeight: 600 }}><Plus size={15} />Add reward</button>
    </div>
    {loading ? <div style={{ color: 'var(--sv-text-dim)', fontSize: 13 }}>Loading rewards...</div> : rewards.length === 0 ? <div style={{ padding: '18px 0', color: 'var(--sv-text-dim)', fontSize: 13 }}>No rewards configured.</div> : <div style={{ display: 'grid', gap: 10 }}>
      {rewards.map((reward, index) => <div key={reward.id || `new-${index}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, alignItems: 'end', padding: 12, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)' }}>
        <div><label style={labelStyle}>Code</label><input style={inputStyle} value={reward.rewardCode} maxLength={50} onChange={event => change(index, 'rewardCode', event.target.value.toUpperCase())} placeholder="FIVE_OFF" /></div>
        <div><label style={labelStyle}>Reward name</label><input style={inputStyle} value={reward.displayName} maxLength={255} onChange={event => change(index, 'displayName', event.target.value)} placeholder="$5 off" /></div>
        <div><label style={labelStyle}>Description</label><input style={inputStyle} value={reward.description || ''} onChange={event => change(index, 'description', event.target.value)} placeholder="Available in store and online" /></div>
        <div><label style={labelStyle}>Points cost</label><input style={inputStyle} type="number" min={1} step={1} value={reward.pointsCost} onChange={event => change(index, 'pointsCost', Number(event.target.value))} /></div>
        <div><label style={labelStyle}>Value (AUD)</label><input style={inputStyle} type="number" min={0.01} step={0.01} value={reward.valueAud} onChange={event => change(index, 'valueAud', Number(event.target.value))} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 34, fontSize: 12, fontWeight: 600, color: 'var(--sv-text-main)' }}><input type="checkbox" checked={reward.isActive} onChange={event => change(index, 'isActive', event.target.checked)} />Active</label>
      </div>)}
    </div>}
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}><button type="button" onClick={save} disabled={saving || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving || loading ? 0.65 : 1 }}><Save size={15} />{saving ? 'Saving...' : 'Save rewards'}</button>{message && <span style={{ fontSize: 12, color: message.error ? 'var(--sv-red)' : 'var(--sv-mint)' }}>{message.text}</span>}</div>
  </section>;
}