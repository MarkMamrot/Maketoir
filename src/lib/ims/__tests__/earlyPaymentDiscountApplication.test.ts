import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/services/IMSMySQLService', () => ({
  getIMSPool: () => ({ getConnection: async () => mocks }),
  imsExecute: vi.fn(),
}));
vi.mock('../ImsRepository', () => ({ ImsCNRepo: {}, ImsPORepo: {}, ImsSORepo: {}, ImsSupplierCNRepo: {} }));
vi.mock('@/services/XeroSyncService', () => ({
  allocateXeroCreditNote: vi.fn(), approveCreditNote: vi.fn(), syncCNAsCreditNote: vi.fn(), syncSupplierCNAsCreditNote: vi.fn(),
}));

import { applyEarlyPaymentDiscountWithPayment } from '../earlyPaymentDiscountApplication';

describe('applyEarlyPaymentDiscountWithPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('FROM ims_early_payment_discount_applications')) return [[]];
      if (sql.includes('FROM ims_sales_orders')) return [[{
        id: 42, business_id: 'biz-1', customer_id: 7, so_number: 'SO-42', location_id: 2,
        early_payment_discount_name: '5% in 10 days', early_payment_discount_basis_points: 500,
        early_payment_discount_cutoff_date: '2026-09-11', tax_treatment: 'inc_tax', tax_code: 'OUTPUT2',
        discount: 0, total_amount: 110,
      }]];
      if (sql.includes('FROM ims_sales_order_items')) return [[{ line_total: 110, tax_rate: 0.1 }]];
      if (sql.includes('FROM ims_sales_order_payments')) return [[]];
      if (sql.includes('INSERT INTO ims_sales_order_payments')) return [{ insertId: 8 }];
      if (sql.includes('MAX(CAST')) return [[{ max_num: 10 }]];
      if (sql.includes('INSERT INTO ims_credit_notes')) return [{ insertId: 11 }];
      if (sql.includes('INSERT INTO ims_credit_note_items')) return [{ insertId: 12 }];
      if (sql.includes('INSERT INTO ims_early_payment_discount_applications')) return [{ insertId: 13 }];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
  });

  it('commits payment, stock-neutral credit note, and application together', async () => {
    const result = await applyEarlyPaymentDiscountWithPayment({
      businessId: 'biz-1', documentType: 'sales_order', documentId: 42, operationKey: 'op-1',
      payment: { paymentDate: '2026-09-11', amount: 104.5, currencyCode: 'AUD', exchangeRate: 1, xeroPostIntent: 'solvantis_only' },
      appliedBy: 5,
    });

    expect(result).toMatchObject({ applicationId: 13, creditNoteId: 11, payment: { id: 8 }, replayed: false });
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("'external','complete'"), expect.any(Array));
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("'custom',0"), expect.any(Array));
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
  });
});