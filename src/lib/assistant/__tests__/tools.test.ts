import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsQuery } = vi.hoisted(() => ({ mockImsQuery: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery }));

import { executeAssistantTool, getAssistantToolDefinitions } from '../tools';

describe('assistant tool policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives separate tool lists for each verified audience', () => {
    expect(getAssistantToolDefinitions('wholesale').map(tool => tool.name)).toEqual([
      'wholesale_catalogue_lookup', 'wholesale_order_summary', 'wholesale_account_summary',
    ]);
    expect(getAssistantToolDefinitions('pos').some(tool => tool.name.startsWith('ims_'))).toBe(false);
  });

  it('rejects a forged cross-audience tool name before querying', async () => {
    await expect(executeAssistantTool({
      audience: 'wholesale', businessId: 'biz-1', contactId: 1, companyId: 2,
      locationId: 3, memberId: 4, memberRole: 'buyer', brandAccess: { mode: 'all', brands: [] },
    }, 'ims_order_summary', { reference: 'SO-1' })).rejects.toThrow('not available');
    expect(mockImsQuery).not.toHaveBeenCalled();
  });

  it('keeps POS product lookup bound to the verified location and business', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    await executeAssistantTool({
      audience: 'pos', businessId: 'biz-1', posUserId: 7, locationId: 9,
      locationName: 'Main', registerId: 2, registerName: 'Front', tier: 'PosUser',
    }, 'pos_product_lookup', { search: 'shirt' });
    expect(mockImsQuery.mock.calls[0][1].slice(0, 2)).toEqual([9, 'biz-1']);
  });

  it('applies selected wholesale brand access to catalogue queries', async () => {
    mockImsQuery.mockResolvedValueOnce([]);
    await executeAssistantTool({
      audience: 'wholesale', businessId: 'biz-1', contactId: 1, companyId: 2,
      locationId: 3, memberId: 4, memberRole: 'buyer', brandAccess: { mode: 'selected', brands: ['Allowed Brand'] },
    }, 'wholesale_catalogue_lookup', { search: 'shirt' });
    expect(mockImsQuery.mock.calls[0][0]).toContain('LOWER(TRIM(p.brand)) IN (?)');
    expect(mockImsQuery.mock.calls[0][1]).toContain('allowed brand');
  });
});