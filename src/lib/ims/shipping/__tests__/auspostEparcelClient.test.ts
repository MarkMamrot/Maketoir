import { describe, expect, it, vi } from 'vitest';

import { AusPostApiError, AusPostEparcelClient } from '../carriers/auspostEparcel/client';

const credentials = {
  apiKey: 'test-key',
  password: 'test-password',
  accountNumber: '0000123456',
};

describe('AusPostEparcelClient', () => {
  it('verifies the account with Basic Auth and account-number headers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ account_number: credentials.accountNumber }), { status: 200 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    await expect(client.verifyAccount()).resolves.toEqual({ account_number: credentials.accountNumber });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://digitalapi.auspost.com.au/shipping/v1/accounts/${credentials.accountNumber}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('test-key:test-password').toString('base64')}`,
          'account-number': credentials.accountNumber,
        }),
      }),
    );
  });

  it('converts millimetres to centimetres and normalizes contract rates', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      items: [{ prices: [{
        product_id: 'T28',
        product_type: 'PARCEL POST',
        calculated_price: 11,
        calculated_price_ex_gst: 10,
        calculated_gst: 1,
        options: { authority_to_leave_option: true, signature_on_delivery_option: false },
      }] }],
    }), { status: 200 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    const rates = await client.getRates({
      from: { name: 'Sender', lines: ['1 Main St'], suburb: 'Melbourne', state: 'VIC', postcode: '3000', country: 'AUSTRALIA' },
      to: { name: 'Buyer', lines: ['2 High St'], suburb: 'Sydney', state: 'NSW', postcode: '2000', country: 'Australia' },
      parcels: [{ reference: 'SO-1-P1', lengthMm: 205, widthMm: 150, heightMm: 99, weightKg: 1.25 }],
    });

    expect(rates).toEqual([[{
      serviceCode: 'T28',
      serviceName: 'PARCEL POST',
      total: 11,
      totalExGst: 10,
      gst: 1,
      authorityToLeaveAvailable: true,
      signatureIncluded: false,
    }]]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
      from: { postcode: '3000', suburb: 'Melbourne', country: 'AU' },
      to: { postcode: '2000', suburb: 'Sydney', country: 'AU' },
      items: [{ item_reference: 'SO-1-P1', length: 20.5, width: 15, height: 9.9, weight: 1.25 }],
    }));
  });

  it('normalizes carrier errors without exposing credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      errors: [{ code: '41007', name: 'CONTRACT_SETUP_ERROR', message: 'Contract is not ready.' }],
    }), { status: 400 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    await expect(client.verifyAccount()).rejects.toEqual(expect.objectContaining<Partial<AusPostApiError>>({
      status: 400,
      message: 'Contract is not ready.',
      errors: [{ code: '41007', name: 'CONTRACT_SETUP_ERROR', message: 'Contract is not ready.', field: undefined }],
    }));
  });
});