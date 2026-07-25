import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import {
  DEFAULT_BUSINESS_TIME_ZONE,
  getBusinessTimeZone,
  isValidBusinessTimeZone,
} from '../businessTimeZone';

describe('businessTimeZone', () => {
  beforeEach(() => mockImsQuery.mockReset());

  it('defaults to Sydney when no timezone is configured', async () => {
    mockImsQuery.mockResolvedValue([]);
    await expect(getBusinessTimeZone('biz-1')).resolves.toBe(DEFAULT_BUSINESS_TIME_ZONE);
  });

  it('returns a valid configured IANA timezone', async () => {
    mockImsQuery.mockResolvedValue([{ value: 'Australia/Perth' }]);
    await expect(getBusinessTimeZone('biz-1')).resolves.toBe('Australia/Perth');
  });

  it('rejects invalid timezone identifiers', () => {
    expect(isValidBusinessTimeZone('Sydney')).toBe(false);
  });
});