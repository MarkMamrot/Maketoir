'use client';

import { Copy, Gift, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface LoyaltyReward {
  id: number;
  displayName: string;
  pointsCost: number;
  valueAud: number;
}

interface IssuedRedemption {
  id: number;
  rewardName: string;
  valueAud: number;
  status: 'issued' | 'used';
  voucherCode: string;
  createdAt: string;
}

interface LoyaltySummary {
  enabled: boolean;
  active: boolean;
  member: boolean;
  shopifyLinked: boolean;
  programName: string;
  pointsLabel: string;
  balancePoints: number;
  rewards: LoyaltyReward[];
  issuedRedemptions: IssuedRedemption[];
}

function claimKey(contactId: number, rewardId: number): string {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `ims:contact:${contactId}:reward:${rewardId}:${nonce}`;
}

export function ContactLoyaltyRewardsSection({ contactId }: { contactId: number }) {
  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issuingRewardId, setIssuingRewardId] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState('');
  const retryKeys = useRef(new Map<number, string>());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/ims/loyalty/shopify-rewards?contactId=${contactId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load loyalty rewards.');
      setSummary(data.loyalty);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load loyalty rewards.');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { void load(); }, [load]);

  const issueReward = async (reward: LoyaltyReward) => {
    if (!confirm(`Deduct ${reward.pointsCost.toLocaleString()} ${summary?.pointsLabel ?? 'points'} and issue ${reward.displayName} for Shopify?`)) return;
    const idempotencyKey = retryKeys.current.get(reward.id) ?? claimKey(contactId, reward.id);
    retryKeys.current.set(reward.id, idempotencyKey);
    setIssuingRewardId(reward.id);
    setError('');
    try {
      const response = await fetch('/api/ims/loyalty/shopify-rewards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, rewardId: reward.id, idempotencyKey }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) retryKeys.current.delete(reward.id);
        throw new Error(data.error || 'Could not issue the Shopify reward.');
      }
      retryKeys.current.delete(reward.id);
      await load();
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'Could not issue the Shopify reward.');
    } finally {
      setIssuingRewardId(null);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedCode(code);
    window.setTimeout(() => setCopiedCode(''), 1500);
  };

  if (loading && !summary) {
    return <div style={{ padding: '12px 0', color: 'var(--sv-text-dim)', fontSize: 12 }}>Loading loyalty rewards...</div>;
  }

  return (
    <section style={{ marginTop: 14, border: '1px solid var(--sv-etch)', borderRadius: 8, overflow: 'hidden', background: 'var(--sv-bg-2)' }}>
      <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid var(--sv-etch)' }}>
        <Gift size={16} aria-hidden="true" style={{ color: 'var(--sv-action)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{summary?.programName ?? 'Loyalty rewards'}</div>
          {summary && <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 1 }}>{summary.balancePoints.toLocaleString()} {summary.pointsLabel} available</div>}
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} title="Refresh loyalty rewards" aria-label="Refresh loyalty rewards" style={{ border: 0, background: 'transparent', color: 'var(--sv-text-dim)', cursor: loading ? 'wait' : 'pointer', padding: 4 }}>
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <div style={{ padding: '12px 14px' }}>
        {error && <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(248,113,113,.1)', color: '#f87171', fontSize: 12 }}>{error}</div>}
        {summary && !summary.enabled && <p style={{ margin: 0, fontSize: 12, color: 'var(--sv-text-dim)' }}>Loyalty is switched off in IMS Settings.</p>}
        {summary?.enabled && !summary.active && <p style={{ margin: 0, fontSize: 12, color: 'var(--sv-text-dim)' }}>The loyalty program has not started yet.</p>}
        {summary?.active && !summary.member && <p style={{ margin: 0, fontSize: 12, color: 'var(--sv-text-dim)' }}>Save this customer as a loyalty member before issuing rewards.</p>}
        {summary?.active && summary.member && !summary.shopifyLinked && <p style={{ margin: 0, fontSize: 12, color: 'var(--sv-text-dim)' }}>This customer must be linked to Shopify before an online reward can be issued.</p>}

        {summary?.active && summary.member && summary.shopifyLinked && (
          <div style={{ display: 'grid', gap: 8 }}>
            {summary.rewards.length === 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--sv-text-dim)' }}>No active rewards are configured.</p>}
            {summary.rewards.map(reward => {
              const affordable = summary.balancePoints >= reward.pointsCost;
              const retrying = retryKeys.current.has(reward.id);
              return (
                <div key={reward.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-text-main)' }}>{reward.displayName}</div>
                    <div style={{ fontSize: 11, color: 'var(--sv-text-dim)', marginTop: 2 }}>{reward.pointsCost.toLocaleString()} {summary.pointsLabel} · ${Number(reward.valueAud).toFixed(2)} off</div>
                  </div>
                  <button type="button" onClick={() => void issueReward(reward)} disabled={!affordable || issuingRewardId !== null} style={{ border: '1px solid var(--sv-action)', borderRadius: 6, background: affordable ? 'var(--sv-action)' : 'transparent', color: affordable ? '#fff' : 'var(--sv-text-dim)', padding: '6px 9px', fontSize: 11, fontWeight: 700, cursor: affordable && issuingRewardId === null ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
                    {issuingRewardId === reward.id ? 'Issuing...' : retrying ? 'Retry' : 'Issue code'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {summary && summary.issuedRedemptions.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase', marginBottom: 7 }}>Recent Shopify codes</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {summary.issuedRedemptions.map(redemption => (
                <div key={redemption.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <code style={{ flex: 1, color: redemption.status === 'issued' ? 'var(--sv-mint)' : 'var(--sv-text-dim)', overflowWrap: 'anywhere' }}>{redemption.voucherCode}</code>
                  <span style={{ color: 'var(--sv-text-dim)', textTransform: 'capitalize' }}>{redemption.status}</span>
                  <button type="button" onClick={() => copyCode(redemption.voucherCode)} title="Copy reward code" aria-label={`Copy ${redemption.voucherCode}`} style={{ border: 0, background: 'transparent', color: copiedCode === redemption.voucherCode ? 'var(--sv-mint)' : 'var(--sv-text-dim)', cursor: 'pointer', padding: 3 }}>
                    <Copy size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}