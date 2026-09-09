'use client';

import { CloudUpload, Copy, Gift, PlusMinus, RefreshCw } from 'lucide-react';
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
  canAdjustPoints: boolean;
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

function adjustmentKey(contactId: number): string {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `ims:adjust:${contactId}:${nonce}`;
}

export function ContactLoyaltyRewardsSection({ contactId }: { contactId: number }) {
  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issuingRewardId, setIssuingRewardId] = useState<number | null>(null);
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [copiedCode, setCopiedCode] = useState('');
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentPoints, setAdjustmentPoints] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustingPoints, setAdjustingPoints] = useState(false);
  const retryKeys = useRef(new Map<number, string>());
  const adjustmentRetryKey = useRef('');

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
  useEffect(() => {
    setAdjustmentOpen(false);
    setAdjustmentPoints('');
    setAdjustmentReason('');
    adjustmentRetryKey.current = '';
  }, [contactId]);

  const syncShopifyMetafields = async () => {
    setSyncingShopify(true);
    setError('');
    try {
      const response = await fetch('/api/ims/loyalty/shopify-metafields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
      const data = await response.json();
      if (!response.ok || data.failed > 0) {
        throw new Error(data.results?.find((result: any) => result.status === 'failed')?.error || data.error || 'Shopify loyalty sync failed.');
      }
      return true;
    } catch (syncError) {
      setError(`The loyalty change was saved, but Shopify could not be updated: ${syncError instanceof Error ? syncError.message : 'Sync failed.'}`);
      return false;
    } finally {
      setSyncingShopify(false);
    }
  };

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
      await syncShopifyMetafields();
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'Could not issue the Shopify reward.');
    } finally {
      setIssuingRewardId(null);
    }
  };

  const adjustPoints = async () => {
    const pointsDelta = Number(adjustmentPoints);
    if (!Number.isInteger(pointsDelta) || pointsDelta === 0) {
      setError('Enter a non-zero whole-number points adjustment.');
      return;
    }
    const reason = adjustmentReason.trim();
    if (!reason) {
      setError('Enter a reason for this adjustment.');
      return;
    }
    const balanceAfter = (summary?.balancePoints ?? 0) + pointsDelta;
    if (balanceAfter < 0) {
      setError('The adjustment cannot reduce the balance below zero.');
      return;
    }
    if (!confirm(`${pointsDelta > 0 ? 'Add' : 'Remove'} ${Math.abs(pointsDelta).toLocaleString()} ${summary?.pointsLabel ?? 'points'}? The balance will become ${balanceAfter.toLocaleString()}.`)) return;

    const idempotencyKey = adjustmentRetryKey.current || adjustmentKey(contactId);
    adjustmentRetryKey.current = idempotencyKey;
    setAdjustingPoints(true);
    setError('');
    try {
      const response = await fetch('/api/ims/loyalty/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, pointsDelta, reason, idempotencyKey }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) adjustmentRetryKey.current = '';
        throw new Error(data.error || 'Loyalty points could not be adjusted.');
      }
      adjustmentRetryKey.current = '';
      setAdjustmentPoints('');
      setAdjustmentReason('');
      setAdjustmentOpen(false);
      await load();
      if (data.warning) setError(data.warning);
    } catch (adjustmentError) {
      setError(adjustmentError instanceof Error ? adjustmentError.message : 'Loyalty points could not be adjusted.');
    } finally {
      setAdjustingPoints(false);
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
        {summary?.canAdjustPoints && summary.member && (
          <button type="button" onClick={() => { setAdjustmentOpen(open => !open); setError(''); }} title="Adjust loyalty points" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer', padding: '5px 8px', fontSize: 11, fontWeight: 700 }}>
            <PlusMinus size={14} aria-hidden="true" />Adjust points
          </button>
        )}
        <button type="button" onClick={() => void load()} disabled={loading} title="Refresh loyalty rewards" aria-label="Refresh loyalty rewards" style={{ border: 0, background: 'transparent', color: 'var(--sv-text-dim)', cursor: loading ? 'wait' : 'pointer', padding: 4 }}>
          <RefreshCw size={15} aria-hidden="true" />
        </button>
        {summary?.member && summary.shopifyLinked && (
          <button type="button" onClick={() => void syncShopifyMetafields()} disabled={syncingShopify} title="Sync loyalty balance to Shopify" aria-label="Sync loyalty balance to Shopify" style={{ border: 0, background: 'transparent', color: 'var(--sv-text-dim)', cursor: syncingShopify ? 'wait' : 'pointer', padding: 4 }}>
            <CloudUpload size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div style={{ padding: '12px 14px' }}>
        {error && <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(248,113,113,.1)', color: '#f87171', fontSize: 12 }}>{error}</div>}
        {adjustmentOpen && summary?.canAdjustPoints && summary.member && (
          <div style={{ marginBottom: 12, padding: 11, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)' }}>
            <div style={{ fontSize: 12, fontWeight: 750, color: 'var(--sv-text-strong)' }}>Manual points adjustment</div>
            <div style={{ marginTop: 3, fontSize: 11, color: 'var(--sv-text-dim)' }}>Use a positive number to add points or a negative number to remove them.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, .45fr) minmax(180px, 1fr)', gap: 8, marginTop: 9 }}>
              <label style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Points
                <input type="number" step="1" value={adjustmentPoints} onChange={event => { setAdjustmentPoints(event.target.value); adjustmentRetryKey.current = ''; }} placeholder="e.g. 100 or -50" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 3, padding: '7px 8px', border: '1px solid var(--sv-etch)', borderRadius: 5, background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', fontSize: 12 }} />
              </label>
              <label style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>Reason
                <input maxLength={500} value={adjustmentReason} onChange={event => { setAdjustmentReason(event.target.value); adjustmentRetryKey.current = ''; }} placeholder="Why is this adjustment required?" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 3, padding: '7px 8px', border: '1px solid var(--sv-etch)', borderRadius: 5, background: 'var(--sv-bg-2)', color: 'var(--sv-text-main)', fontSize: 12 }} />
              </label>
            </div>
            {Number.isInteger(Number(adjustmentPoints)) && Number(adjustmentPoints) !== 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: (summary.balancePoints + Number(adjustmentPoints)) < 0 ? 'var(--sv-red)' : 'var(--sv-text-dim)' }}>
                Balance: {summary.balancePoints.toLocaleString()} → {(summary.balancePoints + Number(adjustmentPoints)).toLocaleString()} {summary.pointsLabel}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 9 }}>
              <button type="button" onClick={() => { setAdjustmentOpen(false); setAdjustmentPoints(''); setAdjustmentReason(''); adjustmentRetryKey.current = ''; }} disabled={adjustingPoints} style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, background: 'transparent', color: 'var(--sv-text-dim)', padding: '6px 9px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Cancel</button>
              <button type="button" onClick={() => void adjustPoints()} disabled={adjustingPoints || !adjustmentPoints || !adjustmentReason.trim()} style={{ border: 0, borderRadius: 5, background: 'var(--sv-action)', color: '#fff', padding: '6px 10px', cursor: adjustingPoints ? 'wait' : 'pointer', opacity: adjustingPoints || !adjustmentPoints || !adjustmentReason.trim() ? .55 : 1, fontSize: 11, fontWeight: 750 }}>{adjustingPoints ? 'Applying...' : 'Apply adjustment'}</button>
            </div>
          </div>
        )}
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