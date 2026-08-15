import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockCreate, mockGet } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockSession }));
vi.mock('@/lib/ims/ImsRepository', () => ({
  ImsCNRepo: { create: mockCreate, get: mockGet, list: vi.fn() },
}));

import { POST } from '../route';

function request(body: unknown) {
  return new Request('http://localhost/api/ims/credit-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const linkedReturn = {
  so_id: 9,
  customer_id: 3,
  location_id: 4,
  cn_date: '2026-08-15',
  tax_treatment: 'inc_tax',
  items: [{ qty: 1, unit_price: 10, tax_rate: 0.1 }],
};

describe('POST /api/ims/credit-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ businessId: 'biz-1', name: 'Alex' });
    mockCreate.mockResolvedValue(42);
    mockGet.mockResolvedValue({ id: 42, cn_number: 'CN-00042' });
  });

  it('rejects a linked return whose lines have no source sales-order provenance', async () => {
    const response = await POST(request(linkedReturn));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('original sales-order line') });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('preserves source sales-order line provenance when creating a linked return', async () => {
    const response = await POST(request({
      ...linkedReturn,
      items: [{ ...linkedReturn.items[0], source_so_item_id: 21 }],
    }));

    expect(response.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ so_id: 9, source: 'manual' }),
      [expect.objectContaining({ source_so_item_id: 21, qty: 1 })],
      'biz-1',
      'Alex',
    );
  });
});