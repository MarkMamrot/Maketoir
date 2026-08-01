import { beforeEach, describe, expect, it, vi } from 'vitest';
const { connection, query } = vi.hoisted(() => ({ connection: { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }, query: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query, getPool: () => ({ getConnection: vi.fn().mockResolvedValue(connection) }) }));
import { ForesightCampaignExperimentLaunchRepository } from '../repositories/ForesightCampaignExperimentLaunchRepository';

const hash = 'c'.repeat(64);
const design = { channel: 'klaviyo', startDate: '2026-08-10', endDate: '2026-08-16', allocationPercent: { control: 50, treatment: 50 }, minimumSamplePerVariant: 500 };
const input = { experimentVersionId: 55, experimentHash: hash, launchedOn: '2026-08-10', scheduledEndOn: '2026-08-16', businessToday: '2026-08-10',
  channel: 'klaviyo' as const, controlExternalId: 'campaign-control', treatmentExternalId: 'campaign-treatment', controlAllocation: 50,
  treatmentAllocation: 50, targetSamplePerVariant: 600, randomAssignmentAttested: true, singleVariableAttested: true,
  implementationDetails: 'Configured two mutually exclusive randomized variants.', deviationsText: null, operatorNote: 'Checked before launch.', launchedBy: 7 };

describe('ForesightCampaignExperimentLaunchRepository', () => {
  beforeEach(() => vi.clearAllMocks());
  it('records an immutable launch for the exact accepted design', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 55, experiment_hash: hash, experiment_json: design, action: 'accepted' }]]).mockResolvedValueOnce([{ insertId: 66 }]);
    const result = await ForesightCampaignExperimentLaunchRepository.create('business-1', 12, input);
    expect(result).toMatchObject({ id: 66, experiment_version_id: 55, channel: 'klaviyo', random_assignment_attested: true });
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('rejects a stale hash before insertion', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 55, experiment_hash: 'd'.repeat(64), experiment_json: design, action: 'accepted' }]]);
    await expect(ForesightCampaignExperimentLaunchRepository.create('business-1', 12, input)).rejects.toThrow('exact latest');
    expect(connection.execute).toHaveBeenCalledOnce(); expect(connection.rollback).toHaveBeenCalledOnce();
  });
  it('rejects a channel that differs from the accepted design', async () => {
    connection.execute.mockResolvedValueOnce([[{ id: 55, experiment_hash: hash, experiment_json: design, action: 'accepted' }]]);
    await expect(ForesightCampaignExperimentLaunchRepository.create('business-1', 12, { ...input, channel: 'meta' })).rejects.toThrow('channel must match');
    expect(connection.execute).toHaveBeenCalledOnce(); expect(connection.rollback).toHaveBeenCalledOnce();
  });
});