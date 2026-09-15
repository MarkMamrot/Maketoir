import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AMAZON_AU_MARKETPLACE_ID,
  buildAmazonAuthorizeUrl,
  confirmAmazonShipment,
  createAmazonReturnsReport,
  downloadAmazonReportDocument,
  exchangeAmazonAuthorizationCode,
  getAmazonReport,
  getAmazonMarketplaceParticipations,
  listAmazonFbmOrders,
  listAmazonFinancialTransactions,
  listAmazonListings,
  listAmazonOrderItems,
  requireActiveAmazonAustraliaParticipation,
  updateAmazonListingInventory,
} from '../amazonSpApi';

describe('Amazon SP-API authorization', () => {
  beforeEach(() => {
    process.env.AMAZON_SP_API_APPLICATION_ID = 'amzn1.sellerapps.app.test';
    process.env.AMAZON_SP_API_LWA_CLIENT_ID = 'client-id';
    process.env.AMAZON_SP_API_LWA_CLIENT_SECRET = 'client-secret';
  });
  afterEach(() => {
    delete process.env.AMAZON_SP_API_APPLICATION_ID;
    delete process.env.AMAZON_SP_API_LWA_CLIENT_ID;
    delete process.env.AMAZON_SP_API_LWA_CLIENT_SECRET;
    delete process.env.AMAZON_SP_API_APP_STAGE;
  });

  it('builds the Australia production consent URL', () => {
    const url = new URL(buildAmazonAuthorizeUrl('signed-state'));
    expect(url.origin).toBe('https://sellercentral.amazon.com.au');
    expect(url.pathname).toBe('/apps/authorize/consent');
    expect(url.searchParams.get('application_id')).toBe('amzn1.sellerapps.app.test');
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.has('version')).toBe(false);
  });

  it('exchanges the short-lived code without exposing app credentials elsewhere', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600, token_type: 'bearer',
    })));
    await expect(exchangeAmazonAuthorizationCode('oauth-code', 'https://example.com/callback', fetchImpl)).resolves.toEqual({
      accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 3600,
    });
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
  });

  it('checks Far East marketplace participation using the LWA token', async () => {
    const participation = {
      marketplace: { id: AMAZON_AU_MARKETPLACE_ID, countryCode: 'AU', name: 'Amazon.com.au', defaultCurrencyCode: 'AUD', domainName: 'amazon.com.au' },
      storeName: 'Retail AU', participation: { isParticipating: true, hasSuspendedListings: false },
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ payload: [participation] })));
    const rows = await getAmazonMarketplaceParticipations('access-token', fetchImpl);
    expect(requireActiveAmazonAustraliaParticipation(rows)).toEqual(participation);
    expect(fetchImpl.mock.calls[0][0]).toContain('sellingpartnerapi-fe.amazon.com/sellers/v1/marketplaceParticipations');
    expect(fetchImpl.mock.calls[0][1].headers['x-amz-access-token']).toBe('access-token');
  });

  it('rejects absent, inactive, and suspended Australia participation', () => {
    expect(() => requireActiveAmazonAustraliaParticipation([])).toThrow('does not have access');
    const base = { marketplace: { id: AMAZON_AU_MARKETPLACE_ID }, storeName: 'AU' } as any;
    expect(() => requireActiveAmazonAustraliaParticipation([{ ...base, participation: { isParticipating: false, hasSuspendedListings: false } }])).toThrow('not participating');
    expect(() => requireActiveAmazonAustraliaParticipation([{ ...base, participation: { isParticipating: true, hasSuspendedListings: true } }])).toThrow('suspended');
  });

  it('lists only Australia items and returns the pagination token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ sku: 'SKU-1', summaries: [{ asin: 'B001' }] }],
      pagination: { nextToken: 'next-page' },
    })));
    const result = await listAmazonListings('access-token', 'A1SELLER99', { pageSize: 50, nextToken: 'current' }, fetchImpl);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get('marketplaceIds')).toBe(AMAZON_AU_MARKETPLACE_ID);
    expect(url.searchParams.get('pageSize')).toBe('20');
    expect(url.searchParams.get('pageToken')).toBe('current');
    expect(result.nextToken).toBe('next-page');
  });

  it('does not expose an Amazon listing error response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"secret":"detail"}', { status: 403 }));
    await expect(listAmazonListings('access-token', 'A1SELLER99', {}, fetchImpl)).rejects.toThrow('HTTP 403');
  });

  it('lists paginated Australia seller-fulfilled order updates', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      payload: { Orders: [{ AmazonOrderId: '111-2222222-3333333', PurchaseDate: '2026-09-15T00:00:00Z',
        LastUpdateDate: '2026-09-15T00:01:00Z', OrderStatus: 'Unshipped', FulfillmentChannel: 'MFN' }], NextToken: 'next' },
    })));
    const result = await listAmazonFbmOrders('access-token', {
      lastUpdatedAfter: '2026-09-14T00:00:00Z', lastUpdatedBefore: '2026-09-15T00:00:00Z',
      nextToken: 'current', pageSize: 500,
    }, fetchImpl);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/orders/v0/orders');
    expect(url.searchParams.get('MarketplaceIds')).toBe(AMAZON_AU_MARKETPLACE_ID);
    expect(url.searchParams.get('FulfillmentChannels')).toBe('MFN');
    expect(url.searchParams.get('OrderStatuses')).not.toContain('Pending,');
    expect(url.searchParams.get('LastUpdatedAfter')).toBe('2026-09-14T00:00:00Z');
    expect(url.searchParams.get('NextToken')).toBe('current');
    expect(url.searchParams.get('MaxResultsPerPage')).toBe('100');
    expect(result.nextToken).toBe('next');
  });

  it('lists encoded Amazon order items and rejects a mismatched response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload: {
        AmazonOrderId: '111/222', OrderItems: [{ ASIN: 'B001', OrderItemId: 'item-1', QuantityOrdered: 2 }],
        NextToken: 'next-items',
      } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload: {
        AmazonOrderId: 'different', OrderItems: [],
      } })));
    const result = await listAmazonOrderItems('access-token', '111/222', 'current-items', fetchImpl);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/orders/v0/orders/111%2F222/orderItems');
    expect(url.searchParams.get('NextToken')).toBe('current-items');
    expect(result).toMatchObject({ items: [{ OrderItemId: 'item-1' }], nextToken: 'next-items' });
    await expect(listAmazonOrderItems('access-token', '111/222', null, fetchImpl))
      .rejects.toThrow('unexpected order');
  });

  it('lists released Amazon AU finance transactions using the documented Finances contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      payload: { transactions: [{ transactionId: 'txn-1', description: 'Refund Order' }], nextToken: 'next-1' },
    })));
    const result = await listAmazonFinancialTransactions('access-token', {
      postedAfter: '2026-09-14T00:00:00Z', postedBefore: '2026-09-15T00:00:00Z',
    }, fetchImpl);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/finances/2024-06-19/transactions');
    expect(url.searchParams.get('marketplaceId')).toBe(AMAZON_AU_MARKETPLACE_ID);
    expect(url.searchParams.get('transactionStatus')).toBe('RELEASED');
    expect(result).toEqual({ transactions: [{ transactionId: 'txn-1', description: 'Refund Order' }], nextToken: 'next-1' });
  });

  it('rejects an invalid Amazon finance transaction window before calling Amazon', async () => {
    const fetchImpl = vi.fn();
    await expect(listAmazonFinancialTransactions('access-token', {
      postedAfter: '2026-09-15T00:00:00Z', postedBefore: '2026-09-14T00:00:00Z',
    }, fetchImpl)).rejects.toThrow('dates are invalid');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requests and retrieves an Amazon AU returns report without exposing document errors', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ reportId: 'report-1' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        reportId: 'report-1', reportType: 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE',
        processingStatus: 'DONE', reportDocumentId: 'document-1',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://download.example/report', compressionAlgorithm: 'GZIP' })));
    await expect(createAmazonReturnsReport('access-token', '2026-09-01T00:00:00Z', '2026-09-15T00:00:00Z', fetchImpl))
      .resolves.toBe('report-1');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      reportType: 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE', marketplaceIds: [AMAZON_AU_MARKETPLACE_ID],
    });
    await expect(getAmazonReport('access-token', 'report-1', fetchImpl)).resolves.toMatchObject({ processingStatus: 'DONE' });
    await expect(downloadAmazonReportDocument('access-token', 'document-1', fetchImpl)).resolves.toEqual({
      url: 'https://download.example/report', compressionAlgorithm: 'GZIP',
    });
  });

  it('confirms one exact Amazon AU package using the documented Orders v0 contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(confirmAmazonShipment('access-token', '111/222', {
      packageReferenceId: '123', carrierCode: 'Other', carrierName: 'Test Carrier',
      shippingMethod: 'Express', trackingNumber: 'TRACK-1', shipDate: '2026-09-15T01:02:03.000Z',
      orderItems: [{ orderItemId: 'item-1', quantity: 2 }],
    }, fetchImpl)).resolves.toBeUndefined();
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/orders/v0/orders/111%2F222/shipmentConfirmation');
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
    expect(fetchImpl.mock.calls[0][1].headers['x-amz-access-token']).toBe('access-token');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      marketplaceId: AMAZON_AU_MARKETPLACE_ID,
      packageDetail: {
        packageReferenceId: '123', carrierCode: 'Other', carrierName: 'Test Carrier',
        shippingMethod: 'Express', trackingNumber: 'TRACK-1', shipDate: '2026-09-15T01:02:03.000Z',
        orderItems: [{ orderItemId: 'item-1', quantity: 2 }],
      },
    });
  });

  it('validates Amazon shipment identity and does not expose provider response details', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"message":"private provider detail"}', { status: 400 }));
    const valid = {
      packageReferenceId: '1', carrierCode: 'Australia Post', trackingNumber: 'TRACK-1',
      shipDate: '2026-09-15T01:02:03Z', orderItems: [{ orderItemId: 'item-1', quantity: 1 }],
    };
    await expect(confirmAmazonShipment('access-token', '111', { ...valid, packageReferenceId: '0' }, fetchImpl))
      .rejects.toThrow('positive numeric');
    await expect(confirmAmazonShipment('access-token', '111', { ...valid, carrierCode: 'Other' }, fetchImpl))
      .rejects.toThrow('carrier name');
    await expect(confirmAmazonShipment('access-token', '111', valid, fetchImpl))
      .rejects.toThrow('Amazon shipment confirmation failed with HTTP 400.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('replaces seller-fulfilled inventory for one exact seller SKU', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sku: 'SKU / 1', status: 'ACCEPTED', submissionId: 'submission-1', issues: [],
    })));
    await expect(updateAmazonListingInventory('access-token', 'A1SELLER99', 'SKU / 1', 7.8, fetchImpl)).resolves.toMatchObject({
      sku: 'SKU / 1', status: 'ACCEPTED', submissionId: 'submission-1',
    });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/listings/2021-08-01/items/A1SELLER99/SKU%20%2F%201');
    expect(url.searchParams.get('marketplaceIds')).toBe(AMAZON_AU_MARKETPLACE_ID);
    expect(fetchImpl.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      productType: 'PRODUCT',
      patches: [{ op: 'replace', path: '/attributes/fulfillment_availability',
        value: [{ fulfillment_channel_code: 'DEFAULT', quantity: 7 }] }],
    });
  });

  it('reports Amazon inventory rejection without exposing its response body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sku: 'SKU-1', status: 'INVALID', submissionId: 'submission-1',
      issues: [{ code: '99001', message: 'private listing detail', severity: 'ERROR' }],
    })));
    await expect(updateAmazonListingInventory('access-token', 'A1SELLER99', 'SKU-1', 2, fetchImpl))
      .rejects.toThrow('Amazon rejected the inventory update (99001).');
  });
});
