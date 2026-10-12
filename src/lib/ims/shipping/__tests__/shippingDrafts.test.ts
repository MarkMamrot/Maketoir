import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareShippingRequest, validateShippingRecipient } from '../shippingDrafts';

const mocks = vi.hoisted(() => ({ account: vi.fn(), order: vi.fn(), location: vi.fn() }));
vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: async () => ({ execute: mocks.account, release: vi.fn() }) }),
}));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsSORepo: { get: mocks.order }, ImsLocationsRepo: { get: mocks.location } }));
const recipient = { name: 'New recipient', lines: ['2 New St'], suburb: 'Sydney', state: 'NSW', postcode: '2000', country: 'AU', email: '', phone: '' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.mockResolvedValue([[{ id: 9, provider: 'auspost_eparcel', dispatch_location_id: 3 }]]);
  mocks.order.mockResolvedValue({
    id: 10, so_number: 'SO-10', status: 'confirmed', so_type: 'online', location_id: 3, customer_name: 'Original buyer',
    delivery_address: 'Old address', delivery_suburb: 'Melbourne', delivery_state: 'VIC', delivery_postcode: '3000', delivery_country: 'AU',
    items: [{ id: 5, qty_ordered: 2, qty_fulfilled: 0 }],
  });
  mocks.location.mockResolvedValue({ name: 'Store', address: '1 Main St', city: 'Melbourne', state: 'VIC', postcode: '3000', country: 'AU' });
});
describe('recipient override preparation', () => {
  it('validates and prepares the proposed address without changing the Sales Order', async () => {
    const input = {
      businessId: 'tenant-1', carrierAccountId: 9,
      shipments: [{ soId: 10, recipient, parcels: [{ parcelNumber: 1, lengthMm: 200, widthMm: 100, heightMm: 100, weightKg: 1,
        allocations: [{ soItemId: 5, quantity: 2 }] }] }],
    };
    const prepared = await prepareShippingRequest(input);
    expect(prepared.entries[0].recipient).toEqual(recipient);
    expect(prepared.entries[0].order.delivery_address).toBe('Old address');
    expect(mocks.order).toHaveBeenCalledWith(10, 'tenant-1');
    expect(mocks.location).toHaveBeenCalledWith(3, 'tenant-1');
  });
  it('rejects incomplete and malformed address overrides', () => {
    for (const change of [{ name: '' }, { lines: [] }, { lines: [{}] }, { state: 'bad' }, { postcode: '20' }, { country: 'bad' }]) {
      expect(() => validateShippingRecipient({ ...recipient, ...change } as typeof recipient)).toThrow();
    }
  });
  it('normalizes Australian country aliases and international ISO countries', () => {
    expect(validateShippingRecipient({ ...recipient, country: 'Australia' }).country).toBe('AU');
    expect(validateShippingRecipient({ ...recipient, country: ' nz ', state: '' }).country).toBe('NZ');
  });
});
