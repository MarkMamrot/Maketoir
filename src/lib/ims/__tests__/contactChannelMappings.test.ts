import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.query, imsExecute: mocks.execute }));

import {
  getContactChannelMapping,
  recordInboundContactChannelMapping,
} from '@/lib/ims/contactChannelMappings';

describe('contact channel mappings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('looks up an external customer only within the exact instance', async () => {
    mocks.query.mockResolvedValue([{ id: 1, business_id: 'business-1', channel_instance_id: 'instance-2',
      contact_id: 9, external_customer_id: 'customer-7', mapping_status: 'linked' }]);

    await expect(getContactChannelMapping({ businessId: ' business-1 ', channelInstanceId: ' instance-2 ',
      externalCustomerId: ' customer-7 ' })).resolves.toMatchObject({ contactId: 9, channelInstanceId: 'instance-2' });
    expect(mocks.query.mock.calls[0][1]).toEqual(['business-1', 'instance-2', 'customer-7']);
  });

  it('records an inbound mapping without updating either owned identity on duplicate', async () => {
    mocks.execute.mockResolvedValue({ affectedRows: 1 });
    mocks.query.mockResolvedValue([{ id: 1, business_id: 'business-1', channel_instance_id: 'instance-2',
      contact_id: 9, external_customer_id: 'customer-7', mapping_status: 'linked' }]);

    await expect(recordInboundContactChannelMapping({ businessId: 'business-1', channelInstanceId: 'instance-2',
      contactId: 9, externalCustomerId: 'customer-7' })).resolves.toMatchObject({ mappingStatus: 'linked' });
    const duplicateUpdate = mocks.execute.mock.calls[0][0].split('ON DUPLICATE KEY UPDATE')[1];
    expect(duplicateUpdate.trimStart()).toMatch(/^mapping_status = IF/);
    expect(duplicateUpdate).toContain('last_inbound_at = CURRENT_TIMESTAMP(3)');
    expect(duplicateUpdate).toContain("'conflict'");
  });

  it('returns a conflict rather than reassigning another store identity', async () => {
    mocks.execute.mockResolvedValue({ affectedRows: 2 });
    mocks.query.mockResolvedValue([{ id: 1, business_id: 'business-1', channel_instance_id: 'instance-2',
      contact_id: 10, external_customer_id: 'customer-7', mapping_status: 'conflict' }]);

    await expect(recordInboundContactChannelMapping({ businessId: 'business-1', channelInstanceId: 'instance-2',
      contactId: 9, externalCustomerId: 'customer-7' })).resolves.toMatchObject({
        contactId: 10, externalCustomerId: 'customer-7', mappingStatus: 'conflict',
      });
  });

  it('rejects incomplete or invalid ownership keys before querying', async () => {
    await expect(recordInboundContactChannelMapping({ businessId: 'business-1', channelInstanceId: '',
      contactId: 0, externalCustomerId: '' })).rejects.toThrow('external customer identity');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});