import { describe, expect, it, vi } from 'vitest';

import { AusPostApiError, AusPostEparcelClient } from '../carriers/auspostEparcel/client';

const credentials = {
  apiKey: 'test-key',
  password: 'test-password',
  accountNumber: '0000123456',
};

describe('AusPostEparcelClient', () => {
  it('uses the official article tracking endpoint with authenticated headers and a timeout', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tracking_results: [{ tracking_id: 'ARTICLE1',
      trackable_items: [{ article_id: 'ARTICLE1', status: 'In Transit', events: [] }] }] })));
    const result = await new AusPostEparcelClient(credentials, fetchImpl as typeof fetch).trackArticles(['ARTICLE1']);
    expect(result[0].outcome).toBe('pending');
    expect(fetchImpl).toHaveBeenCalledWith('https://digitalapi.auspost.com.au/shipping/v1/track?tracking_ids=ARTICLE1',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ 'account-number': credentials.accountNumber, Authorization: expect.stringMatching(/^Basic /) }) }));
  });
  it.each([401, 403, 429, 500])('does not expose vendor payloads in tracking HTTP failures (%s)', async status => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'PRIVATE BUYER test-password' }] }), { status }));
    await expect(new AusPostEparcelClient(credentials, fetchImpl as typeof fetch).trackArticles(['ARTICLE1'])).rejects.toThrow(/tracking failed/);
    try { await new AusPostEparcelClient(credentials, fetchImpl as typeof fetch).trackArticles(['ARTICLE1']); }
    catch (error) { expect(String(error)).not.toMatch(/PRIVATE|test-password/); }
  });
  it('updates the existing shipment with existing item IDs using the official PUT body, not a create wrapper', async () => {
    const body = {
      shipment_reference: 'SO-source-reference', customer_reference_1: 'SO-1',
      from: { name: 'Sender', lines: ['1 St'] }, to: { name: 'Buyer', lines: ['2 St'] },
      items: [{ item_id: 'existing-item', product_id: 'T28', length: 20, width: 10, height: 10, weight: 1, authority_to_leave: false }],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ shipments: [{ shipment_id: 'existing-shipment' }] }), { status: 201 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);
    await client.updateShipment('existing-shipment', body);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://digitalapi.auspost.com.au/shipping/v1/shipments/existing-shipment',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) }),
    );
    expect(() => client.updateShipment('existing-shipment', { ...body, items: [{ ...body.items[0], item_id: '' }] })).toThrow(/existing/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('reads back only the requested existing shipment', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ shipments: [{ shipment_id: 'shipment/1' }] }), { status: 200 }));
    const client = new AusPostEparcelClient(credentials, fetchImpl as typeof fetch);
    expect(await client.getShipment('shipment/1')).toEqual({ shipment_id: 'shipment/1' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://digitalapi.auspost.com.au/shipping/v1/shipments?shipment_ids=shipment%2F1',
      expect.anything(),
    );
    await expect(client.getShipment('wrong-shipment')).rejects.toThrow(/requested shipment/);
  });
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
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
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