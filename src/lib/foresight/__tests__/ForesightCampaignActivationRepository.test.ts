import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnection } = vi.hoisted(() => ({
  mockConnection: {
    beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
  },
}));
vi.mock('@/services/MySQLService', () => ({
  query: vi.fn(),
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