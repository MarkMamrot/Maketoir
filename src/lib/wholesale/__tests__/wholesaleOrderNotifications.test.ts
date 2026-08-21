import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class Resend { emails = { send: mocks.send }; } }));

import { sendWholesaleOrderSubmittedReceipt } from '../wholesaleOrderNotifications';

const input = {
  businessId: 'business-1', salesOrderId: 81, salesOrderNumber: 'SO-0081',
  supplierName: 'Supplier & Co', supplierSlug: 'supplier', buyerEmail: 'buyer@example.com',
  buyerName: '<Buyer>', companyName: 'Buyer Co', total: 110,
  items: [{ product_name: '<Raincoat>', variant_label: 'Green & Medium', sku: 'RAIN-1', qty: 2, line_total: 110 }],
};

describe('wholesale order notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
    mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('escapes buyer and product data and uses a stable order idempotency key', async () => {
    await sendWholesaleOrderSubmittedReceipt(input);

    const [message, options] = mocks.send.mock.calls[0];
    expect(message.html).toContain('&lt;Buyer&gt;');
    expect(message.html).toContain('&lt;Raincoat&gt;');
    expect(message.html).not.toContain('<Buyer>');
    expect(message.html).toContain('https://example.com/wholesale/supplier/orders');
    expect(options).toEqual({ idempotencyKey: 'wholesale-order-submitted-business-1-81' });
  });

  it('does not attempt delivery when email is not configured', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendWholesaleOrderSubmittedReceipt(input)).resolves.toEqual({ sent: false, reason: 'not_configured' });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});