import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));

import { listAmazonMappings, setAmazonMappingControls } from '../amazonMappingRepository';

describe('Amazon mapping repository', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists mappings for only one business and channel instance', async () => {
    mocks.query.mockResolvedValue([{ mapping_id: 1, variant_id: 'variant-1', external_product_id: 'B001',
      external_variant_id: 'SKU-1', mapping_status: 'linked', metadata_json: '{"itemName":"Amazon Item"}',
      last_seen_at: '2026-09-15', product_name: 'IMS Item', ims_sku: 'SKU-1', is_selected: 1,
      inventory_enabled: 0, price_enabled: 0 }]);
    const rows = await listAmazonMappings({ businessId: 'business-1', channelInstanceId: 'instance-1' });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-1', 500]);
    expect(rows[0]).toMatchObject({ mappingId: 1, sellerSku: 'SKU-1', itemName: 'Amazon Item', selected: true });
  });

  it('updates only linked mappings selected by ID in the exact instance', async () => {
    mocks.execute.mockResolvedValue({ affectedRows: 2 });
    await expect(setAmazonMappingControls({ businessId: 'business-1', channelInstanceId: 'instance-1',
      mappingIds: [7, 7, 8, -1], inventoryEnabled: true })).resolves.toBe(2);
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain("mapping.mapping_status = 'linked'");
    expect(sql).toContain('mapping.business_id = ? AND mapping.channel_instance_id = ?');
    expect(sql).toContain('is_selected = is_selected');
    expect(sql).toContain('inventory_enabled = VALUES(inventory_enabled)');
    expect(params).toEqual([1, 1, 0, 'business-1', 'instance-1', 7, 8]);
  });

  it('does nothing without valid IDs or a requested change', async () => {
    await expect(setAmazonMappingControls({ businessId: 'business-1', channelInstanceId: 'instance-1', mappingIds: [] , selected: true })).resolves.toBe(0);
    await expect(setAmazonMappingControls({ businessId: 'business-1', channelInstanceId: 'instance-1', mappingIds: [1] })).resolves.toBe(0);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});