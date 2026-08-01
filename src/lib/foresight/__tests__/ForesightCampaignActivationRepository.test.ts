import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnection, mockQuery, mockExecute } = vi.hoisted(() => ({
  mockConnection: {
    beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  },
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
}));
vi.mock('@/services/MySQLService', () => ({
  query: mockQuery,
  execute: mockExecute,
  getPool: () => ({ getConnection: vi.fn().mockResolvedValue(mockConnection) }),
}));

import {
  CampaignActivationValidationError,
  ForesightCampaignActivationRepository,
} from '../repositories/ForesightCampaignActivationRepository';

const document = {
  assets: [
    { id: 'meta-primary', channel: 'meta' },
    { id: 'brief', channel: 'campaign_brief' },
  ],
};

const input = {
  deliverableVersionId: 80,
  documentHash: 'b'.repeat(64),
  activatedOn: '2026-08-01',
  businessToday: '2026-08-02',
  channels: [{ channel: 'meta' as const, campaignId: 'campaign-123', adSetId: null, flowId: null }],
  destinationUrl: 'https://example.com/gifts',
  utm: { utm_source: 'meta', utm_campaign: 'winter-gifts' },
  assetIds: ['meta-primary'],
  publishedDetails: 'Used the approved product set with no discount.',
  deviationsText: null,
  operatorNote: 'Launched manually after final platform review.',
  horizonDays: 7,
  activatedBy: 7,
};

describe('ForesightCampaignActivationRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads only due tenant-scoped activations without an outcome', async () => {
    mockQuery.mockResolvedValue([]);
    await ForesightCampaignActivationRepository.listDue('business-1', '2026-08-08');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/activation\.business_id = \?[\s\S]*followup_end <= \?[\s\S]*outcome\.id IS NULL/),
      ['business-1', '2026-08-08'],
    );
  });

  it('persists campaign outcomes idempotently', async () => {
    mockExecute.mockResolvedValue({ insertId: 93 });
    const activation = {
      id: 91, business_id: 'business-1', thread_id: 12, plan_version_id: 41,
      plan_hash: 'a'.repeat(64), deliverable_version_id: 80, document_hash: 'b'.repeat(64),
      activated_on: '2026-08-01', channels_json: [], destination_url: null, utm_json: {},
      asset_ids_json: ['meta-primary'], published_details: 'Published.', deviations_text: null,
      operator_note: 'Checked.', horizon_days: 7, baseline_start: '2026-07-25', baseline_end: '2026-07-31',
      followup_start: '2026-08-02', followup_end: '2026-08-08', first_assessment_date: '2026-08-09',
      activated_by: 7, created_at: '2026-08-01', horizonDays: 7, baselineStart: '2026-07-25',
      baselineEnd: '2026-07-31', followupStart: '2026-08-02', followupEnd: '2026-08-08',
      firstAssessmentDate: '2026-08-09',
    };
    const window = {
      windowStart: '2026-07-25', windowEnd: '2026-07-31', dayCount: 7,
      onlineRevenueExTax: 1400, contributionBeforeAds: 700, paidMediaSpend: 350,
      mer: 4, contributionPoas: 2, qualityIssues: [],
    };
    await expect(ForesightCampaignActivationRepository.createOutcome('business-1', {
      activation,
      assessment: {
        direction: 'improved', primaryMetric: 'contribution_before_ads', baselineValue: 700,
        followupValue: 840, baseline: window, followup: { ...window, contributionBeforeAds: 840 },
        explanation: 'Observed improvement without causal inference.',
      },
    })).resolves.toBe(93);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'),
      expect.arrayContaining(['business-1', 91, 12, 80, 'b'.repeat(64), 7, 'improved']),
    );
  });

  it('persists an immutable activation for the exact accepted package', async () => {
    mockConnection.execute
      .mockResolvedValueOnce([[{
        id: 80, plan_version_id: 41, plan_hash: 'a'.repeat(64), document_hash: 'b'.repeat(64),
        document_json: document, action: 'accepted',
      }]])
      .mockResolvedValueOnce([{ insertId: 91 }]);

    const result = await ForesightCampaignActivationRepository.create('business-1', 12, input);

    expect(result).toMatchObject({
      id: 91, baseline_start: '2026-07-25', baseline_end: '2026-07-31',
      followup_start: '2026-08-02', followup_end: '2026-08-08', first_assessment_date: '2026-08-09',
    });
    expect(mockConnection.execute).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO foresight_campaign_activations'),
      expect.arrayContaining(['business-1', 12, 41, 'a'.repeat(64), 80, 'b'.repeat(64)]),
    );
    expect(mockConnection.commit).toHaveBeenCalledOnce();
  });

  it('rolls back without inserting when the exact package is not accepted', async () => {
    mockConnection.execute.mockResolvedValueOnce([[{
      id: 80, plan_version_id: 41, plan_hash: 'a'.repeat(64), document_hash: 'b'.repeat(64),
      document_json: document, action: 'revision_requested',
    }]]);

    await expect(ForesightCampaignActivationRepository.create('business-1', 12, input))
      .rejects.toThrow('must be accepted');
    expect(mockConnection.execute).toHaveBeenCalledOnce();
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
  });

  it('rolls back without inserting an asset outside the accepted package', async () => {
    mockConnection.execute.mockResolvedValueOnce([[{
      id: 80, plan_version_id: 41, plan_hash: 'a'.repeat(64), document_hash: 'b'.repeat(64),
      document_json: document, action: 'accepted',
    }]]);

    await expect(ForesightCampaignActivationRepository.create('business-1', 12, {
      ...input, assetIds: ['invented-asset'],
    })).rejects.toBeInstanceOf(CampaignActivationValidationError);
    expect(mockConnection.execute).toHaveBeenCalledOnce();
    expect(mockConnection.rollback).toHaveBeenCalledOnce();
  });
});