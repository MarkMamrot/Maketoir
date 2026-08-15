import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockCreate, mockGet } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsSupplierCNRepo: { create: mockCreate, get: mockGet, list: vi.fn() },
  SupplierReturnConflict: class SupplierReturnConflict extends Error {},
}));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/supplier-credit-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const linkedReturn = {
  po_id: 9,
  supplier_id: 3,
  location_id: 4,
  scn_date: '2026-08-15',
  tax_treatment: 'ex_tax',
  items: [{ qty: 1, unit_cost: 10, tax_rate: 0.1, restock: true }],
};

describe('POST /api/ims/supplier-credit-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', username: 'Alex' });
    mockCreate.mockResolvedValue(52);
    mockGet.mockResolvedValue({ id: 52, scn_number: 'SCN-00052' });
  });

  it('rejects a linked physical return with no source PO provenance', async () => {
    const response = await POST(request(linkedReturn));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('original purchase-order line') });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('preserves source PO provenance when creating a physical return', async () => {
    const response = await POST(request({
      ...linkedReturn,
      items: [{ ...linkedReturn.items[0], source_po_item_id: 21 }],
    }));

    expect(response.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ po_id: 9 }),
      [expect.objectContaining({ source_po_item_id: 21, qty: 1 })],
      'biz-1',
      'Alex',
    );
  });

  it('allows an unlinked PO financial correction that does not move stock', async () => {
    const response = await POST(request({
      ...linkedReturn,
      items: [{ ...linkedReturn.items[0], restock: false }],
    }));

    expect(response.status).toBe(200);
    expect(mockCreate).toHaveBeenCalled();
  });
});