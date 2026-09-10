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

  it('quotes international parcels with AU origin and an ISO destination country', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [{ prices: [] }] }), { status: 200 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    await client.getRates({
      from: { name: 'Sender', lines: ['1 Main St'], suburb: 'Melbourne', state: 'VIC', postcode: '3000', country: 'Australia' },
      to: { name: 'Buyer', lines: ['2 Queen St'], suburb: 'Auckland', state: '', postcode: '1010', country: 'NZ' },
      parcels: [{ reference: 'SO-2-P1', lengthMm: 200, widthMm: 150, heightMm: 100, weightKg: 1 }],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://digitalapi.auspost.com.au/shipping/v1/prices/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          from: { postcode: '3000', suburb: 'Melbourne', country: 'AU' },
          to: { postcode: '1010', suburb: 'Auckland', country: 'NZ' },
          items: [{ item_reference: 'SO-2-P1', length: 20, width: 15, height: 10, weight: 1 }],
        }),
      }),
    );
  });

  it('creates international shipments through the shared shipments endpoint', async () => {
    const payload = { shipments: [] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ shipments: [] }), { status: 201 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    await expect(client.createInternationalShipments(payload)).resolves.toEqual({ shipments: [] });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://digitalapi.auspost.com.au/shipping/v1/shipments',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) }),
    );
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

  it('creates an Australia Post order from existing shipments', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ order: { order_id: 'AP00042' } }), { status: 201 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    await expect(client.createOrderFromShipments({ orderReference: 'SOL-MAN-42', shipmentIds: ['SHIP-1', 'SHIP-2'] }))
      .resolves.toEqual({ orderId: 'AP00042' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://digitalapi.auspost.com.au/shipping/v1/orders',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          order_reference: 'SOL-MAN-42', payment_method: 'CHARGE_TO_ACCOUNT',
          shipments: [{ shipment_id: 'SHIP-1' }, { shipment_id: 'SHIP-2' }],
        }),
      }),
    );
  });

  it('retrieves an order for reconciliation', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      order: { order_id: 'AP00042', shipments: [{ shipment_id: 'SHIP-1' }, { shipment_id: 'SHIP-2' }] },
    }), { status: 200 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    await expect(client.getOrder('AP00042')).resolves.toEqual({ orderId: 'AP00042', shipmentIds: ['SHIP-1', 'SHIP-2'] });
  });

  it('downloads the printable order summary as PDF bytes', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    await expect(client.getOrderSummaryPdf('AP00042')).resolves.toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://digitalapi.auspost.com.au/shipping/v1/accounts/0000123456/orders/AP00042/summary',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/pdf' }) }),
    );
  });

  it('rejects a non-PDF order summary response', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);

    await expect(client.getOrderSummaryPdf('AP00042')).rejects.toThrow('Australia Post did not return a PDF order summary.');
  });
});