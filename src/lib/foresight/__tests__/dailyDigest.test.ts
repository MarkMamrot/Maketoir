import { describe, expect, it } from 'vitest';
import { buildDailyDigest } from '../dailyDigest';

function recommendation(overrides: Record<string, unknown> = {}): any {
  return {
    id: 1, business_id: 'business-1', fingerprint: 'fingerprint', state: 'pending_approval',
    channel: 'paid_media', subject_type: 'portfolio', subject_id: 'all', rule_id: 'mer_decline',
    evidence_json: { metricKeys: [], sourceIds: [], windowStart: '2026-07-20', windowEnd: '2026-07-26', quality: { grade: 'good', issues: [] } },
    proposed_action_json: {}, proposal_hash: 'hash', confidence: 0.9, expires_at: null,
    created_at: '2026-07-27T00:00:00.000Z', updated_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

function build(overrides: Record<string, unknown> = {}) {
  return buildDailyDigest({
    digestDate: '2026-07-29', recommendations: [recommendation()], events: [], implementations: [], outcomes: [],
    ...overrides,
  } as any);
}

describe('daily Foresight digest', () => {
  it('surfaces pending approvals as high-priority work', () => {
    const digest = build();
    expect(digest.counts).toMatchObject({ total: 1, high: 1, pendingApproval: 1 });
    expect(digest.items[0]).toMatchObject({ kind: 'pending_approval', recommendationId: 1 });
  });

  it('surfaces approved recommendations not implemented after the grace period', () => {
    const digest = build({
      recommendations: [recommendation({ state: 'approved' })],
      events: [{ recommendation_id: 1, to_state: 'approved', created_at: '2026-07-26T12:00:00.000Z' }],
    });
    expect(digest.items[0]).toMatchObject({ kind: 'implementation_overdue', priority: 'high' });
    expect(digest.items[0].detail).toContain('3 days ago');
  });

  it('does not call an approved recommendation overdue once implementation is recorded', () => {
    const digest = build({
      recommendations: [recommendation({ state: 'approved' })],
      events: [{ recommendation_id: 1, to_state: 'approved', created_at: '2026-07-20T12:00:00.000Z' }],
      implementations: [{ recommendation_id: 1 }],
    });
    expect(digest.counts.implementationOverdue).toBe(0);
  });

  it('surfaces near-expiry and blocking data quality independently', () => {
    const digest = build({ recommendations: [recommendation({
      state: 'shadow', expires_at: '2026-07-30T00:00:00.000Z',
      evidence_json: { quality: { grade: 'blocked', issues: [{ severity: 'blocking', message: 'Commerce sync failed.' }] } },
    })] });
    expect(digest.items.map((item) => item.kind)).toEqual(['expiring_soon', 'data_quality_blocked']);
  });

  it('includes only outcomes created on the digest date and prioritizes worsened results', () => {
    const digest = build({
      recommendations: [recommendation({ state: 'rejected' })],
      outcomes: [
        { recommendation_id: 1, direction: 'worsened', condition_state: 'persisted', horizon_days: 7, created_at: '2026-07-29T08:00:00.000Z' },
        { recommendation_id: 1, direction: 'improved', condition_state: 'resolved', horizon_days: 7, created_at: '2026-07-28T08:00:00.000Z' },
      ],
    });
    expect(digest.counts.outcomeAvailable).toBe(1);
    expect(digest.items[0]).toMatchObject({ kind: 'outcome_available', priority: 'high' });
  });

  it('shows the exact monitoring window for a verified execution without an outcome', () => {
    const digest = build({
      digestDate: '2026-07-30',
      recommendations: [recommendation({ state: 'succeeded' })],
      executions: [{
        recommendation_id: 1, state: 'succeeded', compensates_execution_id: null,
        completion_date: '2026-07-30',
      }],
    });

    expect(digest.counts.monitoringActive).toBe(1);
    expect(digest.items[0]).toMatchObject({ kind: 'monitoring_active', priority: 'info' });
    expect(digest.items[0].detail).toContain('2026-07-31 through 2026-08-06');
    expect(digest.items[0].detail).toContain('2026-08-07');
  });
});