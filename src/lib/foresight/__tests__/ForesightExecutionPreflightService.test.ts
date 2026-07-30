import { describe, expect, it } from 'vitest';
import {
  normalizeCampaignSetting,
  normalizeCampaignStatus,
} from '../ForesightExecutionPreflightService';

describe('Google campaign setting normalization', () => {
  it('maps protobuf campaign status enums to stable names', () => {
    expect(normalizeCampaignStatus(2)).toBe('ENABLED');
    expect(normalizeCampaignStatus('2')).toBe('ENABLED');
    expect(normalizeCampaignStatus(3)).toBe('PAUSED');
    expect(normalizeCampaignStatus(4)).toBe('REMOVED');
  });

  it('normalizes named statuses without changing their meaning', () => {
    expect(normalizeCampaignStatus('enabled')).toBe('ENABLED');
    expect(normalizeCampaignStatus('PAUSED')).toBe('PAUSED');
  });

  it('uses normalized status in live campaign settings', () => {
    const setting = normalizeCampaignSetting({
      customer: { id: '1112223333', currency_code: 'AUD' },
      campaign: { id: '123', name: 'PMax', status: 2 },
      campaign_budget: {
        id: '456', name: 'PMax budget', amount_micros: 100_000_000,
        explicitly_shared: false, reference_count: 1,
      },
    });

    expect(setting.status).toBe('ENABLED');
  });
});