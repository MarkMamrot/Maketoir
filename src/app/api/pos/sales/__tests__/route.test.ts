import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookiesGet: vi.fn(),
  getSession: vi.fn(),
  imsExecute: vi.fn(),
  completeSale: vi.fn(),
  getCurrentRegisterSession: vi.fn(),
  imsQuery: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: () => ({ get: mocks.cookiesGet }) }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsExecute: mocks.imsExecute, imsQuery: mocks.imsQuery }));
vi.mock('@/lib/db/PosRepository', () => ({
  PosSalesRepo: { complete: mocks.completeSale, findByLocalId: vi.fn() },
  PosRegisterSessionRepo: { getCurrent: mocks.getCurrentRegisterSession },
}));
vi.mock('@/lib/ims/cacheHelper', () => ({ refreshVariantCache: vi.fn() }));
vi.mock('@/lib/ims/createNotification', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/ims/ImsRepository', () => ({ ImsCNRepo: {} }));
vi.mock('@/lib/ims/businessTimeZone', () => ({ getBusinessTimeZone: vi.fn() }));
vi.mock('@/lib/ims/posReturnCreditNote', () => ({ buildPosReturnCreditNoteItems: vi.fn(), isPosExchange: vi.fn() }));
vi.mock('@/lib/ims/LoyaltyRepository', () => ({
  LoyaltyRepository: {},
  LoyaltyReturnBlockedError: class extends Error {},
  LoyaltyValidationError: class extends Error {},
}));

import { POST } from '../route';
import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';

describe('POST /api/pos/sales training mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookiesGet.mockReturnValue({ value: JSON.stringify({ businessId: 'sage', location_id: 2, register_id: 3, pos_user_id: 4, full_name: 'Trainer' }) });
    mocks.getSession.mockResolvedValue({ businessId: 'sage' });
    mocks.imsExecute.mockResolvedValue({ insertId: 91 });
    mocks.imsQuery.mockResolvedValue([]);
    mocks.getCurrentRegisterSession.mockResolvedValue(null);
  });

  it('records an isolated audit snapshot without invoking the real sale repository', async () => {
    const response = await POST(new Request('http://localhost/api/pos/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_training: true,
        local_id: 'training-1',
        location_id: 2,
        status: 'completed',
        sale_type: 'sale',
        subtotal: 11,
        tax_total: 1,
        total: 11,
        items: [{ variant_id: 'variant-1', name: 'Test item', qty: 1, unit_price: 11, line_total: 11 }],
        payments: [{ payment_method: 'Cash', amount: 11, reference: 'must-not-be-stored' }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, training: true, training_id: 91 });
    expect(mocks.completeSale).not.toHaveBeenCalled();
    expect(mocks.getCurrentRegisterSession).not.toHaveBeenCalled();
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_training_sales'),
      expect.arrayContaining(['sage', 'training-1', 2]),
    );
    expect(JSON.stringify(mocks.imsExecute.mock.calls[0][1])).not.toContain('must-not-be-stored');
  });

  it('rejects customer-value transactions in training mode', async () => {
    const response = await POST(new Request('http://localhost/api/pos/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_training: true,
        local_id: 'training-2',
        items: [{ name: 'Test item', qty: 1 }],
        payments: [{ payment_method: 'Store Credit', amount: 10 }],
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.imsExecute).not.toHaveBeenCalled();
    expect(mocks.completeSale).not.toHaveBeenCalled();
  });

  it('rejects return quantities even when the submitted sale type says sale', async () => {
    const response = await POST(new Request('http://localhost/api/pos/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_training: true,
        local_id: 'training-return',
        sale_type: 'sale',
        status: 'completed',
        items: [{ name: 'Returned item', qty: -1 }],
        payments: [{ payment_method: 'Cash', amount: -10 }],
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('returns atomic FIFO stock shortages as actionable conflicts', async () => {
    mocks.completeSale.mockRejectedValue(new FifoCostingConflict(
      'Cannot complete this stock movement for variant variant-1: FIFO layers at this location cover 1 units, but 2 are required. Reconcile the missing 1 units before retrying.',
    ));

    const response = await POST(new Request('http://localhost/api/pos/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location_id: 2,
        status: 'completed',
        sale_type: 'sale',
        items: [{ variant_id: 'variant-1', name: 'Product', qty: 2, unit_price: 10, line_total: 20 }],
        payments: [{ payment_method: 'Cash', amount: 20 }],
      }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'FIFO_COSTING_CONFLICT',
      error: expect.stringContaining('Reconcile the missing 1 units'),
    });
  });
});