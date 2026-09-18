export const AMAZON_AU_MARKETPLACE_ID = 'A39IBJ37TRP1C6';
export const AMAZON_FAR_EAST_ENDPOINT = 'https://sellingpartnerapi-fe.amazon.com';
export const AMAZON_FAR_EAST_SANDBOX_ENDPOINT = 'https://sandbox.sellingpartnerapi-fe.amazon.com';
export const AMAZON_AU_SELLER_CENTRAL = 'https://sellercentral.amazon.com.au';

export function amazonSpApiSandboxEnabled(): boolean {
  const enabled = process.env.AMAZON_SP_API_USE_SANDBOX?.trim().toLowerCase() === 'true';
  if (enabled && process.env.NODE_ENV === 'production') {
    throw new Error('Amazon SP-API sandbox mode cannot run in production.');
  }
  return enabled;
}

function amazonSpApiEndpoint(): string {
  return amazonSpApiSandboxEnabled()
    ? AMAZON_FAR_EAST_SANDBOX_ENDPOINT
    : AMAZON_FAR_EAST_ENDPOINT;
}

interface AmazonLwaTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface AmazonMarketplaceParticipation {
  marketplace: {
    id: string;
    countryCode: string;
    name: string;
    defaultCurrencyCode: string;
    domainName: string;
  };
  storeName: string;
  participation: {
    isParticipating: boolean;
    hasSuspendedListings: boolean;
  };
}

function amazonConfig() {
  const applicationId = String(process.env.AMAZON_SP_API_APPLICATION_ID ?? '').trim();
  const clientId = String(process.env.AMAZON_SP_API_LWA_CLIENT_ID ?? '').trim();
  const clientSecret = String(process.env.AMAZON_SP_API_LWA_CLIENT_SECRET ?? '').trim();
  if (!applicationId || !clientId || !clientSecret) {
    throw new Error('Amazon SP-API public application credentials are not configured.');
  }
  return { applicationId, clientId, clientSecret };
}

export function amazonSpApiConfigured(): boolean {
  try { amazonConfig(); return true; } catch { return false; }
}

export function buildAmazonAuthorizeUrl(state: string): string {
  const { applicationId } = amazonConfig();
  const url = new URL('/apps/authorize/consent', AMAZON_AU_SELLER_CENTRAL);
  url.searchParams.set('application_id', applicationId);
  url.searchParams.set('state', state);
  if (process.env.AMAZON_SP_API_APP_STAGE === 'draft') url.searchParams.set('version', 'beta');
  return url.toString();
}

async function requestLwaToken(
  body: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<AmazonLwaTokenResponse> {
  const response = await fetchImpl('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null) as AmazonLwaTokenResponse | null;
  if (!response.ok) throw new Error(`Amazon authorization failed with HTTP ${response.status}.`);
  if (!payload?.access_token || !Number.isFinite(Number(payload.expires_in))) {
    throw new Error('Amazon returned an invalid authorization response.');
  }
  return payload;
}

export async function exchangeAmazonAuthorizationCode(
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = amazonConfig();
  const payload = await requestLwaToken(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  }), fetchImpl);
  if (!payload.refresh_token) throw new Error('Amazon did not return a refresh token.');
  return { accessToken: payload.access_token!, refreshToken: payload.refresh_token, expiresIn: Number(payload.expires_in) };
}

export async function refreshAmazonAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = amazonConfig();
  const payload = await requestLwaToken(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }), fetchImpl);
  return { accessToken: payload.access_token!, expiresIn: Number(payload.expires_in) };
}

export async function getAmazonMarketplaceParticipations(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AmazonMarketplaceParticipation[]> {
  const response = await fetchImpl(`${amazonSpApiEndpoint()}/sellers/v1/marketplaceParticipations`, {
    method: 'GET',
    headers: {
      'x-amz-access-token': accessToken,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      'user-agent': 'Solvantis/1.0 (Language=TypeScript)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as { payload?: AmazonMarketplaceParticipation[] } | null;
  if (!response.ok) throw new Error(`Amazon marketplace check failed with HTTP ${response.status}.`);
  return Array.isArray(body?.payload) ? body.payload : [];
}

export function requireActiveAmazonAustraliaParticipation(rows: AmazonMarketplaceParticipation[]): AmazonMarketplaceParticipation {
  const australia = rows.find(row => row.marketplace?.id === AMAZON_AU_MARKETPLACE_ID);
  if (!australia && amazonSpApiSandboxEnabled()) {
    const fixture = rows.find(row => row.participation?.isParticipating && !row.participation.hasSuspendedListings);
    if (fixture) return {
      ...fixture,
      marketplace: {
        ...fixture.marketplace,
        id: AMAZON_AU_MARKETPLACE_ID,
        countryCode: 'AU',
        name: 'Amazon.com.au Sandbox',
        defaultCurrencyCode: 'AUD',
        domainName: 'amazon.com.au',
      },
    };
  }
  if (!australia) throw new Error('This seller account does not have access to Amazon Australia.');
  if (!australia.participation?.isParticipating) throw new Error('This seller account is not participating in Amazon Australia.');
  if (australia.participation.hasSuspendedListings) throw new Error('Amazon Australia listings are suspended for this seller account.');
  return australia;
}

export interface AmazonListingItem {
  sku: string;
  summaries?: Array<{ asin?: string; itemName?: string; status?: string[] }>;
  issues?: Array<{ code?: string; message?: string; severity?: string }>;
  fulfillmentAvailability?: Array<{ fulfillmentChannelCode?: string; quantity?: number }>;
}

export interface AmazonListingSubmissionIssue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING' | 'INFO' | string;
}

export interface AmazonListingSubmission {
  sku: string;
  status: 'ACCEPTED' | 'INVALID' | 'VALID' | string;
  submissionId: string;
  issues: AmazonListingSubmissionIssue[];
}

export interface AmazonMoney {
  CurrencyCode?: string;
  Amount?: string;
}

export interface AmazonOrderAddress {
  Name?: string;
  CompanyName?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  City?: string;
  StateOrRegion?: string;
  PostalCode?: string;
  CountryCode?: string;
  Phone?: string;
}

export interface AmazonOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  LastUpdateDate: string;
  OrderStatus: 'PendingAvailability' | 'Pending' | 'Unshipped' | 'PartiallyShipped' | 'Shipped' | 'InvoiceUnconfirmed' | 'Canceled' | 'Unfulfillable' | string;
  FulfillmentChannel?: 'MFN' | 'AFN' | string;
  MarketplaceId?: string;
  OrderTotal?: AmazonMoney;
  PaymentMethod?: string;
  PaymentMethodDetails?: string[];
  ShipmentServiceLevelCategory?: string;
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  ShippingAddress?: AmazonOrderAddress;
  BuyerInfo?: { BuyerName?: string; BuyerEmail?: string; PurchaseOrderNumber?: string };
}

export interface AmazonOrderItem {
  ASIN: string;
  OrderItemId: string;
  SellerSKU?: string;
  Title?: string;
  QuantityOrdered: number;
  QuantityShipped?: number;
  ItemPrice?: AmazonMoney;
  ItemTax?: AmazonMoney;
  ShippingPrice?: AmazonMoney;
  ShippingTax?: AmazonMoney;
  ShippingDiscount?: AmazonMoney;
  ShippingDiscountTax?: AmazonMoney;
  PromotionDiscount?: AmazonMoney;
  PromotionDiscountTax?: AmazonMoney;
}

export interface AmazonShipmentConfirmationItem {
  orderItemId: string;
  quantity: number;
}

export interface AmazonShipmentConfirmation {
  packageReferenceId: string;
  carrierCode: string;
  carrierName?: string;
  shippingMethod?: string;
  trackingNumber: string;
  shipDate: string;
  orderItems: AmazonShipmentConfirmationItem[];
}

export interface AmazonFinancialIdentifier {
  relatedIdentifierName?: string;
  relatedIdentifierValue?: string;
}

export interface AmazonFinancialTransaction {
  sellingPartnerMetadata?: { sellingPartnerId?: string; marketplaceId?: string };
  relatedIdentifiers?: AmazonFinancialIdentifier[];
  transactionType?: string;
  transactionId?: string;
  transactionStatus?: string;
  description?: string;
  postedDate?: string;
  totalAmount?: { currencyCode?: string; currencyAmount?: number };
  items?: Array<{
    description?: string;
    totalAmount?: { currencyCode?: string; currencyAmount?: number };
    relatedIdentifiers?: Array<{ itemRelatedIdentifierName?: string; itemRelatedIdentifierValue?: string }>;
    contexts?: Array<{ contextType?: string; asin?: string; sku?: string; quantityShipped?: number; fulfillmentNetwork?: string }>;
    breakdowns?: Array<{ breakdownType?: string; breakdownAmount?: { currencyCode?: string; currencyAmount?: number } }>;
  }>;
  breakdowns?: Array<{ breakdownType?: string; breakdownAmount?: { currencyCode?: string; currencyAmount?: number } }>;
}

export interface AmazonReportStatus {
  reportId: string;
  reportType: string;
  processingStatus: 'IN_QUEUE' | 'IN_PROGRESS' | 'CANCELLED' | 'DONE' | 'FATAL' | string;
  reportDocumentId?: string;
}

function amazonOrdersHeaders(accessToken: string) {
  return {
    'x-amz-access-token': accessToken,
    'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
    'user-agent': 'Solvantis/1.0 (Language=TypeScript)',
  };
}

export async function listAmazonFbmOrders(
  accessToken: string,
  options: { lastUpdatedAfter: string; lastUpdatedBefore?: string; nextToken?: string | null; pageSize?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ orders: AmazonOrder[]; nextToken: string | null }> {
  const url = new URL('/orders/v0/orders', amazonSpApiEndpoint());
  url.searchParams.set('MarketplaceIds', AMAZON_AU_MARKETPLACE_ID);
  url.searchParams.set('FulfillmentChannels', 'MFN');
  url.searchParams.set('OrderStatuses', 'Unshipped,PartiallyShipped,Shipped,InvoiceUnconfirmed,Canceled');
  url.searchParams.set('LastUpdatedAfter', options.lastUpdatedAfter);
  if (options.lastUpdatedBefore) url.searchParams.set('LastUpdatedBefore', options.lastUpdatedBefore);
  if (options.nextToken) url.searchParams.set('NextToken', options.nextToken);
  url.searchParams.set('MaxResultsPerPage', String(Math.max(1, Math.min(100, Math.floor(options.pageSize ?? 100)))));
  const response = await fetchImpl(url, {
    method: 'GET', headers: amazonOrdersHeaders(accessToken), cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as {
    payload?: { Orders?: AmazonOrder[]; NextToken?: string };
  } | null;
  if (!response.ok) throw new Error(`Amazon orders request failed with HTTP ${response.status}.`);
  return {
    orders: Array.isArray(body?.payload?.Orders) ? body.payload.Orders : [],
    nextToken: String(body?.payload?.NextToken ?? '').trim() || null,
  };
}

export async function listAmazonOrderItems(
  accessToken: string,
  amazonOrderId: string,
  nextToken: string | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ items: AmazonOrderItem[]; nextToken: string | null }> {
  const url = new URL(`/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/orderItems`, amazonSpApiEndpoint());
  if (nextToken) url.searchParams.set('NextToken', nextToken);
  const response = await fetchImpl(url, {
    method: 'GET', headers: amazonOrdersHeaders(accessToken), cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as {
    payload?: { AmazonOrderId?: string; OrderItems?: AmazonOrderItem[]; NextToken?: string };
  } | null;
  if (!response.ok) throw new Error(`Amazon order items request failed with HTTP ${response.status}.`);
  if (body?.payload?.AmazonOrderId && body.payload.AmazonOrderId !== amazonOrderId) {
    throw new Error('Amazon returned order items for an unexpected order.');
  }
  return {
    items: Array.isArray(body?.payload?.OrderItems) ? body.payload.OrderItems : [],
    nextToken: String(body?.payload?.NextToken ?? '').trim() || null,
  };
}

export async function listAmazonFinancialTransactions(
  accessToken: string,
  options: { postedAfter: string; postedBefore: string; nextToken?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<{ transactions: AmazonFinancialTransaction[]; nextToken: string | null }> {
  const postedAfter = new Date(options.postedAfter);
  const postedBefore = new Date(options.postedBefore);
  if (!Number.isFinite(postedAfter.getTime()) || !Number.isFinite(postedBefore.getTime()) || postedAfter >= postedBefore) {
    throw new Error('Amazon finance transaction dates are invalid.');
  }
  const url = new URL('/finances/2024-06-19/transactions', amazonSpApiEndpoint());
  url.searchParams.set('postedAfter', postedAfter.toISOString());
  url.searchParams.set('postedBefore', postedBefore.toISOString());
  url.searchParams.set('marketplaceId', AMAZON_AU_MARKETPLACE_ID);
  url.searchParams.set('transactionStatus', 'RELEASED');
  if (options.nextToken) url.searchParams.set('nextToken', options.nextToken);
  const response = await fetchImpl(url, {
    method: 'GET', headers: amazonOrdersHeaders(accessToken), cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as {
    payload?: { transactions?: AmazonFinancialTransaction[]; nextToken?: string };
  } | null;
  if (!response.ok) throw new Error(`Amazon finance transactions request failed with HTTP ${response.status}.`);
  return {
    transactions: Array.isArray(body?.payload?.transactions) ? body.payload.transactions : [],
    nextToken: String(body?.payload?.nextToken ?? '').trim() || null,
  };
}

export async function createAmazonReturnsReport(
  accessToken: string,
  dataStartTime: string,
  dataEndTime: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${amazonSpApiEndpoint()}/reports/2021-06-30/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...amazonOrdersHeaders(accessToken) },
    body: JSON.stringify({
      reportType: 'GET_FLAT_FILE_RETURNS_DATA_BY_RETURN_DATE',
      marketplaceIds: [AMAZON_AU_MARKETPLACE_ID],
      dataStartTime,
      dataEndTime,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as { reportId?: string } | null;
  if (!response.ok) throw new Error(`Amazon returns report request failed with HTTP ${response.status}.`);
  const reportId = String(body?.reportId ?? '').trim();
  if (!reportId) throw new Error('Amazon did not return a returns report ID.');
  return reportId;
}

export async function getAmazonReport(
  accessToken: string,
  reportId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AmazonReportStatus> {
  const response = await fetchImpl(
    `${amazonSpApiEndpoint()}/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
    { method: 'GET', headers: amazonOrdersHeaders(accessToken), cache: 'no-store', signal: AbortSignal.timeout(30_000) },
  );
  const body = await response.json().catch(() => null) as AmazonReportStatus | null;
  if (!response.ok) throw new Error(`Amazon returns report status failed with HTTP ${response.status}.`);
  if (!body?.reportId || !body.processingStatus) throw new Error('Amazon returned an invalid report status.');
  return body;
}

export async function downloadAmazonReportDocument(
  accessToken: string,
  reportDocumentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; compressionAlgorithm: string | null }> {
  const response = await fetchImpl(
    `${amazonSpApiEndpoint()}/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
    { method: 'GET', headers: amazonOrdersHeaders(accessToken), cache: 'no-store', signal: AbortSignal.timeout(30_000) },
  );
  const body = await response.json().catch(() => null) as { url?: string; compressionAlgorithm?: string } | null;
  if (!response.ok) throw new Error(`Amazon returns report document request failed with HTTP ${response.status}.`);
  const url = String(body?.url ?? '').trim();
  if (!url) throw new Error('Amazon did not return a report document URL.');
  return { url, compressionAlgorithm: String(body?.compressionAlgorithm ?? '').trim() || null };
}

export async function confirmAmazonShipment(
  accessToken: string,
  amazonOrderIdInput: string,
  confirmation: AmazonShipmentConfirmation,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const amazonOrderId = amazonOrderIdInput.trim();
  const packageReferenceId = String(confirmation.packageReferenceId ?? '').trim();
  const carrierCode = String(confirmation.carrierCode ?? '').trim();
  const carrierName = String(confirmation.carrierName ?? '').trim();
  const shippingMethod = String(confirmation.shippingMethod ?? '').trim();
  const trackingNumber = String(confirmation.trackingNumber ?? '').trim();
  const shipDate = String(confirmation.shipDate ?? '').trim();
  if (!amazonOrderId) throw new Error('Amazon order ID is required.');
  if (!/^[1-9]\d*$/.test(packageReferenceId)) throw new Error('Amazon package reference ID must be a positive numeric value.');
  if (!carrierCode) throw new Error('Amazon carrier code is required.');
  if (carrierCode.toLowerCase() === 'other' && !carrierName) throw new Error('Amazon carrier name is required when the carrier code is Other.');
  if (!trackingNumber) throw new Error('Amazon tracking number is required.');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(shipDate) || !Number.isFinite(Date.parse(shipDate))) {
    throw new Error('Amazon ship date must be a valid ISO 8601 timestamp.');
  }
  if (!Array.isArray(confirmation.orderItems) || confirmation.orderItems.length === 0) {
    throw new Error('Amazon shipment confirmation requires at least one order item.');
  }
  const orderItems = confirmation.orderItems.map(item => {
    const orderItemId = String(item?.orderItemId ?? '').trim();
    const quantity = Number(item?.quantity);
    if (!orderItemId) throw new Error('Amazon shipment order item ID is required.');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Amazon shipment item quantity must be a positive integer.');
    return { orderItemId, quantity };
  });
  const url = new URL(
    `/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/shipmentConfirmation`,
    amazonSpApiEndpoint(),
  );
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...amazonOrdersHeaders(accessToken) },
    body: JSON.stringify({
      marketplaceId: AMAZON_AU_MARKETPLACE_ID,
      packageDetail: {
        packageReferenceId,
        carrierCode,
        ...(carrierName ? { carrierName } : {}),
        ...(shippingMethod ? { shippingMethod } : {}),
        trackingNumber,
        shipDate,
        orderItems,
      },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 204) throw new Error(`Amazon shipment confirmation failed with HTTP ${response.status}.`);
}

export async function updateAmazonListingInventory(
  accessToken: string,
  sellerId: string,
  sellerSku: string,
  quantityInput: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AmazonListingSubmission> {
  const quantity = Math.max(0, Math.floor(Number(quantityInput)));
  if (!Number.isFinite(quantity)) throw new Error('Amazon inventory quantity is invalid.');
  const url = new URL(
    `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sellerSku)}`,
    amazonSpApiEndpoint(),
  );
  url.searchParams.set('marketplaceIds', AMAZON_AU_MARKETPLACE_ID);
  url.searchParams.set('includedData', 'issues');
  url.searchParams.set('issueLocale', 'en_AU');
  const response = await fetchImpl(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-amz-access-token': accessToken,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      'user-agent': 'Solvantis/1.0 (Language=TypeScript)',
    },
    body: JSON.stringify({
      productType: 'PRODUCT',
      patches: [{
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [{ fulfillment_channel_code: 'DEFAULT', quantity }],
      }],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as Partial<AmazonListingSubmission> | null;
  if (!response.ok) throw new Error(`Amazon inventory update failed with HTTP ${response.status}.`);
  if (!body?.sku || !body.status || !body.submissionId) {
    throw new Error('Amazon returned an invalid inventory update response.');
  }
  const issues = Array.isArray(body.issues) ? body.issues.map(issue => ({
    code: String(issue?.code ?? ''),
    message: String(issue?.message ?? ''),
    severity: String(issue?.severity ?? ''),
  })) : [];
  if (body.status !== 'ACCEPTED' || issues.some(issue => issue.severity === 'ERROR')) {
    const code = issues.find(issue => issue.severity === 'ERROR')?.code;
    throw new Error(`Amazon rejected the inventory update${code ? ` (${code})` : ''}.`);
  }
  return { sku: body.sku, status: body.status, submissionId: body.submissionId, issues };
}

async function requireAcceptedListingSubmission(response: Response, operation: string): Promise<AmazonListingSubmission> {
  const body = await response.json().catch(() => null) as Partial<AmazonListingSubmission> | null;
  if (!response.ok) throw new Error(`Amazon ${operation} failed with HTTP ${response.status}.`);
  if (!body?.sku || !body.status || !body.submissionId) {
    throw new Error(`Amazon returned an invalid ${operation} response.`);
  }
  const issues = Array.isArray(body.issues) ? body.issues.map(issue => ({
    code: String(issue?.code ?? ''), message: String(issue?.message ?? ''), severity: String(issue?.severity ?? ''),
  })) : [];
  if (body.status !== 'ACCEPTED' || issues.some(issue => issue.severity === 'ERROR')) {
    const code = issues.find(issue => issue.severity === 'ERROR')?.code;
    throw new Error(`Amazon rejected the ${operation}${code ? ` (${code})` : ''}.`);
  }
  return { sku: body.sku, status: body.status, submissionId: body.submissionId, issues };
}

export async function putAmazonExistingAsinOffer(
  accessToken: string,
  sellerId: string,
  input: { sellerSku: string; asin: string; price: number; quantity: number },
  fetchImpl: typeof fetch = fetch,
): Promise<AmazonListingSubmission> {
  const url = new URL(
    `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(input.sellerSku)}`,
    amazonSpApiEndpoint(),
  );
  url.searchParams.set('marketplaceIds', AMAZON_AU_MARKETPLACE_ID);
  url.searchParams.set('includedData', 'issues');
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...amazonOrdersHeaders(accessToken) },
    body: JSON.stringify({
      productType: 'PRODUCT',
      requirements: 'LISTING_OFFER_ONLY',
      attributes: {
        condition_type: [{ value: 'new_new', marketplace_id: AMAZON_AU_MARKETPLACE_ID }],
        merchant_suggested_asin: [{ value: input.asin, marketplace_id: AMAZON_AU_MARKETPLACE_ID }],
        purchasable_offer: [{ marketplace_id: AMAZON_AU_MARKETPLACE_ID, currency: 'AUD',
          our_price: [{ schedule: [{ value_with_tax: Number(input.price.toFixed(2)) }] }] }],
        fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: Math.max(0, Math.floor(input.quantity)) }],
      },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  return requireAcceptedListingSubmission(response, 'offer submission');
}

export async function deleteAmazonListingOffer(
  accessToken: string,
  sellerId: string,
  sellerSku: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AmazonListingSubmission> {
  const url = new URL(
    `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sellerSku)}`,
    amazonSpApiEndpoint(),
  );
  url.searchParams.set('marketplaceIds', AMAZON_AU_MARKETPLACE_ID);
  url.searchParams.set('issueLocale', 'en_AU');
  const response = await fetchImpl(url, {
    method: 'DELETE', headers: amazonOrdersHeaders(accessToken), cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  return requireAcceptedListingSubmission(response, 'offer deletion');
}

export async function listAmazonListings(
  accessToken: string,
  sellerId: string,
  options: { pageSize?: number; nextToken?: string | null } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ items: AmazonListingItem[]; nextToken: string | null }> {
  const url = new URL(`/listings/2021-08-01/items/${encodeURIComponent(sellerId)}`, amazonSpApiEndpoint());
  url.searchParams.set('marketplaceIds', AMAZON_AU_MARKETPLACE_ID);
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(20, Math.floor(options.pageSize ?? 20)))));
  url.searchParams.set('includedData', 'summaries,issues,fulfillmentAvailability');
  if (options.nextToken) url.searchParams.set('pageToken', options.nextToken);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      'x-amz-access-token': accessToken,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      'user-agent': 'Solvantis/1.0 (Language=TypeScript)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as {
    items?: AmazonListingItem[];
    pagination?: { nextToken?: string };
  } | null;
  if (!response.ok) throw new Error(`Amazon listings request failed with HTTP ${response.status}.`);
  return {
    items: Array.isArray(body?.items) ? body.items : [],
    nextToken: String(body?.pagination?.nextToken ?? '').trim() || null,
  };
}
