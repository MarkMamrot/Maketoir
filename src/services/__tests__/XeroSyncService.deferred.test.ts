import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

const { mockQuery, mockExecute, mockImsQuery, mockImsExecute, mockXeroApiFetch, mockGetValidAccessToken } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
  mockImsQuery: vi.fn(),
  mockImsExecute: vi.fn(),
  mockXeroApiFetch: vi.fn(),
  mockGetValidAccessToken: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ query: mockQuery, execute: mockExecute }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mockImsQuery, imsExecute: mockImsExecute }));
vi.mock('@/services/XeroService', () => ({
  getValidAccessToken: mockGetValidAccessToken,
  xeroApiFetch: mockXeroApiFetch,
}));

import {
  approveBill,
  syncPOAsDraftBill,
  syncPOAttachmentsToXero,
  syncGiftCardRedemptionReclass,
  syncGiftCardRedemptionReversal,
  syncStoreCreditIssueReclass,
  updateXeroDraftBill,
} from '../XeroSyncService';

function setupBaseMocks() {
  mockExecute.mockResolvedValue({ affectedRows: 1 });
  mockImsQuery.mockResolvedValue([]);
  mockImsExecute.mockResolvedValue({ affectedRows: 1 });
}

it('preserves four-decimal unit precision when approving a bill', async () => {
  mockXeroApiFetch.mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'bill-4', Status: 'AUTHORISED' }] });

  await approveBill('biz-1', 'bill-4', 4860);

  expect(mockXeroApiFetch).toHaveBeenCalledWith(
    'biz-1',
    '/Invoices/bill-4?unitdp=4',
    expect.objectContaining({ method: 'POST' }),
  );
});

describe('Deferred liability lifecycle sync helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
  });

  it('posts gift card redemption as DR liability / CR sales revenue journal', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM xero_sync_log') && sql.includes('sync_type = ?')) return Promise.resolve([]);
      if (sql.includes('FROM xero_account_mappings')) {
        return Promise.resolve([
          { role_key: 'sales_revenue', xero_account_code: '200' },
          { role_key: 'gift_card_liability', xero_account_code: '230' },
        ]);
      }
      if (sql.includes('FROM xero_tracking_mappings')) return Promise.resolve([]);
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return Promise.resolve([{ Field: 'xero_state' }]);
      return Promise.resolve([]);
    });
    mockXeroApiFetch.mockResolvedValueOnce({
      ManualJournals: [{ ManualJournalID: 'mj-1', Status: 'POSTED' }],
    });

    const result = await syncGiftCardRedemptionReclass({
      businessId: 'biz-1',
      amount: 125.5,
      date: '2026-07-25',
      channel: 'pos',
      locationId: 4,
      dedupeKey: 'gift card redeem tx 99',
    });

    expect(result).toBe('mj-1');
    expect(mockXeroApiFetch).toHaveBeenCalledTimes(1);
    const [biz, endpoint, payload] = mockXeroApiFetch.mock.calls[0];
    expect(biz).toBe('biz-1');
    expect(endpoint).toBe('/ManualJournals');
    const lines = payload.body.ManualJournals[0].JournalLines;
    expect(lines[0]).toEqual(expect.objectContaining({
      AccountCode: '230',
      LineAmount: 125.5,
      TaxType: 'NONE',
    }));
    expect(lines[1]).toEqual(expect.objectContaining({
      AccountCode: '200',
      LineAmount: -125.5,
      TaxType: 'NONE',
    }));
  });

  it('skips store credit issue when liability mapping is missing and logs skipped event', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM xero_sync_log') && sql.includes('sync_type = ?')) return Promise.resolve([]);
      if (sql.includes('FROM xero_account_mappings')) {
        return Promise.resolve([{ role_key: 'sales_revenue', xero_account_code: '200' }]);
      }
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return Promise.resolve([{ Field: 'xero_state' }]);
      return Promise.resolve([]);
    });

    const result = await syncStoreCreditIssueReclass({
      businessId: 'biz-1',
      amount: 75,
      date: '2026-07-25',
      channel: 'pos',
      dedupeKey: 'store credit issue tx 11',
    });

    expect(result).toBeNull();
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
    const insertLogCall = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO xero_sync_log') &&
      Array.isArray(call[1]) &&
      call[1][1] === 'store_credit_issue',
    );
    expect(insertLogCall).toBeTruthy();
    expect(insertLogCall?.[1]?.[4]).toBe('skipped');
  });

  it('returns null without posting when successful dedupe key already exists', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM xero_sync_log') && sql.includes('sync_type = ?')) return Promise.resolve([{ id: 1 }]);
      return Promise.resolve([]);
    });

    const result = await syncGiftCardRedemptionReclass({
      businessId: 'biz-1',
      amount: 44,
      date: '2026-07-25',
      channel: 'pos',
      dedupeKey: 'gift card redeem tx 1',
    });

    expect(result).toBeNull();
    expect(mockXeroApiFetch).not.toHaveBeenCalled();
  });

  it('posts the counter-journal when the original redemption succeeded', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("sync_type = 'gift_card_redeem'")) return Promise.resolve([{ id: 12 }]);
      if (sql.includes('FROM xero_sync_log') && sql.includes('sync_type = ?')) return Promise.resolve([]);
      if (sql.includes('FROM xero_account_mappings')) {
        return Promise.resolve([
          { role_key: 'sales_revenue', xero_account_code: '200' },
          { role_key: 'gift_card_liability', xero_account_code: '230' },
        ]);
      }
      if (sql.includes('FROM xero_tracking_mappings')) return Promise.resolve([]);
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return Promise.resolve([{ Field: 'xero_state' }]);
      return Promise.resolve([]);
    });
    mockXeroApiFetch.mockResolvedValueOnce({
      ManualJournals: [{ ManualJournalID: 'mj-reverse-1', Status: 'POSTED' }],
    });

    const result = await syncGiftCardRedemptionReversal({
      businessId: 'biz-1',
      transactionId: 99,
      amount: 125.5,
      date: '2026-07-31',
      locationId: 4,
    });

    expect(result).toBe('mj-reverse-1');
    const lines = mockXeroApiFetch.mock.calls[0][2].body.ManualJournals[0].JournalLines;
    expect(lines[0]).toEqual(expect.objectContaining({ AccountCode: '200', LineAmount: 125.5 }));
    expect(lines[1]).toEqual(expect.objectContaining({ AccountCode: '230', LineAmount: -125.5 }));
  });

  it('records a skipped reversal when the original redemption never posted', async () => {
    mockQuery.mockResolvedValue([]);

    await expect(syncGiftCardRedemptionReversal({
      businessId: 'biz-1',
      transactionId: 99,
      amount: 20,
      date: '2026-07-31',
    })).resolves.toBeNull();

    expect(mockXeroApiFetch).not.toHaveBeenCalled();
    const insertLogCall = mockExecute.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO xero_sync_log') && call[1]?.[1] === 'gift_card_redeem_reverse',
    );
    expect(insertLogCall?.[1]?.[4]).toBe('skipped');
  });
});

describe('PO bill sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupBaseMocks();
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM xero_account_mappings')) {
        return Promise.resolve([{ role_key: 'inventory_asset', xero_account_code: '630' }]);
      }
      if (sql.includes('FROM xero_tracking_mappings')) return Promise.resolve([]);
      if (sql.includes("SHOW COLUMNS FROM xero_sync_log LIKE 'xero_state'")) return Promise.resolve([{ Field: 'xero_state' }]);
      return Promise.resolve([]);
    });
  });

  it('folds line discounts into unit amounts for ACCPAY bills', async () => {
    const po = {
      id: 4851,
      po_number: 'PO-2026-0015',
      supplier_name: 'Supplier',
      location_id: 4,
      order_date: '2026-07-27',
      supplier_invoice_date: '2026-07-29',
      supplier_invoice_number: 'INV-4851',
      payment_terms: '30 days',
      subtotal: 326.4,
      tax_amount: 32.64,
      total_amount: 359.04,
      tax_treatment: 'ex_tax' as const,
      items: [{
        variant_id: 'variant-1',
        sku: 'RS-LTL/KA',
        product_name: 'LED Touch Lamp Kangaroo',
        qty_ordered: 24,
        unit_cost: 16,
        discount_pct: 15,
        tax_rate: 0.1,
        line_total: 326.4,
      }],
    };
    mockXeroApiFetch
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'bill-1', Status: 'DRAFT' }] })
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'bill-1', Status: 'DRAFT' }] })
      .mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'bill-1', Status: 'DRAFT' }] });

    await syncPOAsDraftBill('biz-1', po);
    await updateXeroDraftBill('biz-1', po, 'bill-1');

    expect(mockXeroApiFetch.mock.calls[0][2].body.Invoices[0].LineItems[0]).toEqual(
      expect.objectContaining({ UnitAmount: 13.6 }),
    );
    expect(mockXeroApiFetch.mock.calls[0][1]).toBe('/Invoices?unitdp=4');
    expect(mockXeroApiFetch.mock.calls[0][2].idempotencyKey).toBe(
      createHash('sha256').update('biz-1|po-bill|4851|INV-4851').digest('hex'),
    );
    expect(mockXeroApiFetch.mock.calls[0][2].body.Invoices[0]).toEqual(
      expect.objectContaining({ Date: '2026-07-29', DueDate: '2026-08-28' }),
    );
    expect(mockXeroApiFetch.mock.calls[0][2].body.Invoices[0].LineItems[0]).not.toHaveProperty('DiscountRate');
    expect(mockXeroApiFetch.mock.calls[2][2].body.Invoices[0].LineItems[0]).toEqual(
      expect.objectContaining({ UnitAmount: 13.6 }),
    );
    expect(mockXeroApiFetch.mock.calls[2][1]).toBe('/Invoices/bill-1?unitdp=4');
    expect(mockXeroApiFetch.mock.calls[2][2].body.Invoices[0]).toEqual(
      expect.objectContaining({ Date: '2026-07-29', DueDate: '2026-08-28' }),
    );
    expect(mockXeroApiFetch.mock.calls[2][2].body.Invoices[0].LineItems[0]).not.toHaveProperty('DiscountRate');
  });

  it('derives four-decimal unit amount from the authoritative PO line total', async () => {
    const po = {
      id: 4853,
      po_number: 'PO-2026-0017',
      supplier_name: 'Supplier',
      location_id: 4,
      order_date: '2026-07-27',
      subtotal: 10,
      tax_amount: 1,
      total_amount: 11,
      items: [{
        variant_id: 'variant-1',
        qty_ordered: 3,
        unit_cost: 4,
        discount_pct: 0,
        tax_rate: 0.1,
        line_total: 10,
      }],
    };
    mockXeroApiFetch.mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'bill-3', Status: 'DRAFT' }] });

    await syncPOAsDraftBill('biz-1', po);

    expect(mockXeroApiFetch.mock.calls[0][2].body.Invoices[0].LineItems[0].UnitAmount).toBe(3.3333);
  });

  it('adds a non-taxable account adjustment for a small printed-line subtotal difference', async () => {
    const po = {
      id: 4854,
      po_number: 'PO-2026-0018',
      supplier_name: 'Supplier',
      location_id: 4,
      order_date: '2026-07-27',
      subtotal: 10,
      tax_amount: 1,
      total_amount: 11,
      items: [{
        variant_id: 'variant-1',
        qty_ordered: 3,
        unit_cost: 4,
        discount_pct: 0,
        tax_rate: 0.1,
        line_total: 10.02,
      }],
    };
    mockXeroApiFetch.mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'bill-4', Status: 'DRAFT' }] });

    await syncPOAsDraftBill('biz-1', po);

    expect(mockXeroApiFetch.mock.calls[0][2].body.Invoices[0].LineItems[1]).toEqual(
      expect.objectContaining({
        Description: 'Supplier invoice total adjustment',
        UnitAmount: -0.02,
        AccountCode: '630',
        TaxType: 'NONE',
      }),
    );
  });

  it('uses the PO order date when no supplier invoice date is saved', async () => {
    const po = {
      id: 4852,
      po_number: 'PO-2026-0016',
      supplier_name: 'Supplier',
      location_id: 4,
      order_date: '2026-07-27',
      subtotal: 10,
      tax_amount: 1,
      total_amount: 11,
      items: [],
    };
    mockXeroApiFetch.mockResolvedValueOnce({ Invoices: [{ InvoiceID: 'bill-2', Status: 'DRAFT' }] });

    await syncPOAsDraftBill('biz-1', po);

    expect(mockXeroApiFetch.mock.calls[0][2].body.Invoices[0]).toEqual(
      expect.objectContaining({ Date: '2026-07-27', DueDate: '2026-07-27' }),
    );
  });

  it('uploads a stored supplier invoice to the linked Xero bill', async () => {
    const uploadBase = fs.mkdtempSync(path.join(os.tmpdir(), 'po-xero-attachment-'));
    const previousUploadBase = process.env.UPLOAD_BASE_PATH;
    process.env.UPLOAD_BASE_PATH = uploadBase;
    const invoiceDir = path.join(uploadBase, 'biz-1', 'POs', 'PO-2026-0021');
    fs.mkdirSync(invoiceDir, { recursive: true });
    fs.writeFileSync(path.join(invoiceDir, 'stored-invoice.pdf'), 'invoice');

    mockImsQuery.mockResolvedValueOnce([{
      filename: 'stored-invoice.pdf',
      original_name: 'Supplier Invoice 21.pdf',
      mime_type: 'application/pdf',
    }]);
    mockGetValidAccessToken.mockResolvedValueOnce({ accessToken: 'token', tenantId: 'tenant' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 200 }));

    try {
      const warnings = await syncPOAttachmentsToXero('biz-1', 21, 'PO-2026-0021', 'xero-bill-21');

      expect(warnings).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.xero.com/api.xro/2.0/Invoices/xero-bill-21/Attachments/Supplier%20Invoice%2021.pdf',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      fetchSpy.mockRestore();
      fs.rmSync(uploadBase, { recursive: true, force: true });
      if (previousUploadBase === undefined) delete process.env.UPLOAD_BASE_PATH;
      else process.env.UPLOAD_BASE_PATH = previousUploadBase;
    }
  });

  it('returns a warning when Xero rejects an attachment', async () => {
    const uploadBase = fs.mkdtempSync(path.join(os.tmpdir(), 'po-xero-attachment-'));
    const previousUploadBase = process.env.UPLOAD_BASE_PATH;
    process.env.UPLOAD_BASE_PATH = uploadBase;
    const invoiceDir = path.join(uploadBase, 'biz-1', 'POs', 'PO-2026-0022');
    fs.mkdirSync(invoiceDir, { recursive: true });
    fs.writeFileSync(path.join(invoiceDir, 'invoice.pdf'), 'invoice');

    mockImsQuery.mockResolvedValueOnce([{
      filename: 'invoice.pdf',
      original_name: 'invoice.pdf',
      mime_type: 'application/pdf',
    }]);
    mockGetValidAccessToken.mockResolvedValueOnce({ accessToken: 'token', tenantId: 'tenant' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    try {
      const warnings = await syncPOAttachmentsToXero('biz-1', 22, 'PO-2026-0022', 'xero-bill-22');

      expect(warnings).toEqual([expect.stringContaining('Xero attachment upload failed (403)')]);
      expect(mockExecute.mock.calls.some(call => call[1]?.[1] === 'po_attachment' && call[1]?.[4] === 'error')).toBe(true);
    } finally {
      fetchSpy.mockRestore();
      fs.rmSync(uploadBase, { recursive: true, force: true });
      if (previousUploadBase === undefined) delete process.env.UPLOAD_BASE_PATH;
      else process.env.UPLOAD_BASE_PATH = previousUploadBase;
    }
  });

  it('does not fail the parent PO sync when Xero attachment authentication fails', async () => {
    mockImsQuery.mockResolvedValueOnce([{
      filename: 'invoice.pdf',
      original_name: 'invoice.pdf',
      mime_type: 'application/pdf',
    }]);
    mockGetValidAccessToken.mockRejectedValueOnce(new Error('Xero connection expired'));

    await expect(syncPOAttachmentsToXero('biz-1', 23, 'PO-2026-0023', 'xero-bill-23'))
      .resolves.toEqual(['Xero connection expired']);
  });
});
