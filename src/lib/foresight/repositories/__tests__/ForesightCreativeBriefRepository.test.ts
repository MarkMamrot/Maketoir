import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({
  getPool: () => ({ getConnection: vi.fn().mockResolvedValue({
    execute: mocks.execute, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release,
  }) }),
  query: mocks.query,
}));

import { hashCreativeBrief } from '../../creative/creativeBrief';
import { ForesightCreativeBriefRepository } from '../ForesightCreativeBriefRepository';
import { PlanningThreadConflictError } from '../ForesightPlanningRepository';

const humanContext = { intendedAudience: 'Returning gift buyers', intendedMessage: 'Thoughtful gifts without guesswork',
  offer: 'No discount; free wrapping', offlineContext: 'Window display changes next week' };
const document = {
  schemaVersion: 1, creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', title: 'Gift confidence refresh',
  hypothesis: 'Clear proof and gift context may improve qualified engagement.', audience: 'Returning gift buyers',
  singleMindedProposition: 'A thoughtful gift, chosen confidently.', proofPoints: ['Curated range', 'Free wrapping'], tone: ['Warm', 'Direct'],
  formats: [{ format: '4:5 image', placement: 'Meta feed', adaptationNotes: 'Keep proof above the fold.' }],
  variants: [{ id: 'control', change: 'Current product-led execution', rationale: 'Preserve baseline.' },
    { id: 'proof', change: 'Lead with free wrapping proof', rationale: 'Test confidence cue.' }],
  testMatrix: [{ variantId: 'control', comparison: 'Current execution', primaryMetric: 'platform CTR', guardrails: ['conversion rate'] },
    { variantId: 'proof', comparison: 'Single proof change', primaryMetric: 'platform CTR', guardrails: ['conversion rate'] }],
  exclusions: ['No urgency claim'], successMetric: 'Platform CTR with conversion-rate guardrail',
  stockOfferConstraints: ['Confirm gift range availability before use'], uncertainties: ['No causal result exists yet'], humanContext, publishable: false,
};
const versionInput = { creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', humanContext, document,
  modelId: 'gemini-test', promptVersion: 'creative-brief-v1', promptHash: 'prompt-hash', authoredBy: 7, changeReason: 'Initial brief' };

describe('ForesightCreativeBriefRepository transactions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('reuses the existing creative-linked thread under the creative lock', async () => {
    mocks.execute.mockResolvedValueOnce([[{ id: 44 }]]).mockResolvedValueOnce([[{ id: 81 }]]);
    await expect(ForesightCreativeBriefRepository.getOrCreateReviewThread('business-1', 44, { title: 'Review', createdBy: 7 }))
      .resolves.toEqual({ threadId: 81, created: false });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(String(mocks.execute.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('rejects a stale expected revision before writing a brief version', async () => {
    mocks.execute.mockResolvedValueOnce([[{ revision: 5, assessment_id: 9 }]]);
    await expect(ForesightCreativeBriefRepository.createVersion('business-1', 81, 4, versionInput))
      .rejects.toBeInstanceOf(PlanningThreadConflictError);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a brief generated from a superseded assessment', async () => {
    mocks.execute.mockResolvedValueOnce([[{ revision: 5, assessment_id: 10 }]]);
    await expect(ForesightCreativeBriefRepository.createVersion('business-1', 81, 5, versionInput))
      .rejects.toThrow('assessment changed');
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it('creates the next immutable version with parent and content hash', async () => {
    const latest = { id: 120, version: 2, document_hash: 'different-hash', action: 'revision_requested' };
    mocks.execute.mockResolvedValueOnce([[{ revision: 5, assessment_id: 9 }]])
      .mockResolvedValueOnce([[latest]])
      .mockResolvedValueOnce([{ insertId: 121 }]);
    const result = await ForesightCreativeBriefRepository.createVersion('business-1', 81, 5, versionInput);
    expect(result).toMatchObject({ id: 121, version: 3, parent_id: 120, document_hash: hashCreativeBrief(document) });
    const insertArguments = mocks.execute.mock.calls[2][1] as unknown[];
    expect(insertArguments.slice(0, 7)).toEqual(['business-1', 81, 44, 9, '2026-08-01', 3, 120]);
    expect(insertArguments[9]).toBe(hashCreativeBrief(document));
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('does not supersede an accepted creative brief', async () => {
    mocks.execute.mockResolvedValueOnce([[{ revision: 5, assessment_id: 9 }]])
      .mockResolvedValueOnce([[{ id: 120, version: 2, document_hash: 'different-hash', action: 'accepted' }]]);
    await expect(ForesightCreativeBriefRepository.createVersion('business-1', 81, 5, versionInput))
      .rejects.toThrow('accepted creative brief cannot be superseded');
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it('records a decision only for the exact latest brief and requires negative-decision notes', async () => {
    mocks.execute.mockResolvedValueOnce([[{ id: 120, document_hash: 'brief-hash', action: null }]]);
    await expect(ForesightCreativeBriefRepository.review('business-1', 44, 81, {
      briefVersionId: 120, documentHash: 'brief-hash', action: 'rejected', actorId: 7,
    })).rejects.toThrow('note is required');
    expect(mocks.rollback).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.execute.mockResolvedValueOnce([[{ id: 120, document_hash: 'brief-hash', action: null }]])
      .mockResolvedValueOnce([{ insertId: 130 }]);
    await expect(ForesightCreativeBriefRepository.review('business-1', 44, 81, {
      briefVersionId: 120, documentHash: 'brief-hash', action: 'revision_requested', actorId: 7, note: 'Tighten the offer proof.',
    })).resolves.toBe(130);
    expect(mocks.execute).toHaveBeenLastCalledWith(expect.stringContaining('brief_review_events'),
      ['business-1', 81, 120, 'brief-hash', 'revision_requested', 7, 'Tighten the offer proof.']);
  });

  it('does not inherit a previous version review when the latest brief is unreviewed', async () => {
    mocks.query.mockResolvedValue([{ id: null }]);
    await expect(ForesightCreativeBriefRepository.latestReview('business-1', 81)).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN foresight_creative_brief_review_events'),
      ['business-1', 81]);
  });
});
