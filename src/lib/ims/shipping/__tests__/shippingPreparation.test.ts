import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getShippingOrderPreparation, saveShippingOrderPreparation } from '../shippingPreparation';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), release: vi.fn(), create: vi.fn(), detail: vi.fn(), amend: vi.fn(),
}));
vi.mock('@/services/IMSMySQLService', () => ({ getIMSPool: () => ({ getConnection: async () => mocks }) }));
vi.mock('../shippingDrafts', () => ({ createShippingDrafts: mocks.create }));
vi.mock('../shippingAmendments', () => ({ getShippingEditableDetail: mocks.detail, amendShippingShipment: mocks.amend }));
const parcel = {
  parcelNumber: 1, lengthMm: 200, widthMm: 100, heightMm: 100, weightKg: .5,
  allocations: [{ soItemId: 5, quantity: 1 }],
};
const input = { soId: 10, carrierAccountId: 9, operationKey: 'prepare-1', parcels: [parcel] };
const local = {
  id: 1, operation_key: 'prepare-1:10', provider_shipment_id: null, membership_id: 1, batch_key: null,
};
const detail = {
  shipmentId: 1, revision: 0, updatedAt: '2026-10-12T00:00:00.000Z',
  recipient: { name: 'Buyer', lines: ['1 Main St'], suburb: 'Sydney', state: 'NSW', postcode: '2000', country: 'AU', email: '', phone: '' },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue([[]]);
  mocks.create.mockResolvedValue([{ soId: 10, shipmentId: 1 }]);
  mocks.detail.mockResolvedValue(detail);
  mocks.amend.mockResolvedValue({ shipment: detail });
});

describe('order-owned shipping preparation', () => {
  it('returns an explicit empty preparation before measurement, using tenant-scoped lookup', async () => {
    expect(await getShippingOrderPreparation('tenant-a', 10)).toBeNull();
    expect(mocks.execute.mock.calls[0][1]).toEqual(['tenant-a', 10]);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it('hydrates saved local unbatched preparation without replacing parcel allocations', async () => {
    mocks.execute.mockResolvedValue([[local]]);
    expect(await getShippingOrderPreparation('tenant-a', 10)).toEqual({ shipment: detail });
    expect(mocks.detail).toHaveBeenCalledWith('tenant-a', 1);
  });
  it('saves dimensions as an unbatched draft without service, label or carrier calls', async () => {
    expect(await saveShippingOrderPreparation('tenant-a', 10, input)).toEqual({ shipment: detail });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'tenant-a', operationKey: 'prepare-1', preparationOnly: true, batchId: null,
      carrierAccountId: null,
      shipments: [expect.objectContaining({ soId: 10, parcels: [parcel] })],
    }));
    expect(mocks.create.mock.calls[0][0].shipments[0]).not.toHaveProperty('service');
    expect(mocks.amend).not.toHaveBeenCalled();
  });
  it('replays a first-save operation key through the existing draft idempotency path', async () => {
    mocks.execute.mockResolvedValue([[local]]);
    await saveShippingOrderPreparation('tenant-a', 10, input);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.amend).not.toHaveBeenCalled();
  });
  it('updates existing saved preparation with revision protection and clears stale services', async () => {
    mocks.execute.mockResolvedValue([[local]]);
    await saveShippingOrderPreparation('tenant-a', 10, { ...input, expectedRevision: 0, expectedUpdatedAt: detail.updatedAt });
    expect(mocks.amend).toHaveBeenCalledWith('tenant-a', 1, expect.objectContaining({
      service: null, preparationOnly: true, expectedRevision: 0, expectedUpdatedAt: detail.updatedAt,
      carrierAccountId: null,
      recipient: detail.recipient,
    }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    { provider_shipment_id: 'carrier-1' }, { membership_id: null }, { batch_key: 'batch-1' },
  ])('never prepares a booked or batched shipment again: %j', async changes => {
    mocks.execute.mockResolvedValue([[{ ...local, ...changes }]]);
    await expect(saveShippingOrderPreparation('tenant-a', 10, input)).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.amend).not.toHaveBeenCalled();
  });
  it('requires a reload instead of overwriting another staff member’s new preparation', async () => {
    mocks.execute.mockResolvedValue([[{ ...local, operation_key: 'other-operation:10' }]]);
    await expect(saveShippingOrderPreparation('tenant-a', 10, input)).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.amend).not.toHaveBeenCalled();
  });
  it('rejects a deleted preparation with a stale expected revision', async () => {
    await expect(saveShippingOrderPreparation('tenant-a', 10, { ...input, expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, NaN])('rejects invalid order ID %s before querying', async id => {
    await expect(getShippingOrderPreparation('tenant-a', id)).rejects.toMatchObject({ status: 400 });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects empty dimensions before creating a preparation', async () => {
    await expect(saveShippingOrderPreparation('tenant-a', 10, { ...input, parcels: [] })).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
