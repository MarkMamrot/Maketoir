export const AMAZON_CUSTOMER_LABEL = 'Amazon Customer';
export const AMAZON_PII_ORDER_FIELDS = [
  'delivery_address', 'delivery_address2', 'delivery_suburb', 'delivery_city',
  'delivery_state', 'delivery_postcode', 'delivery_country',
] as const;
export const AMAZON_PII_CONTACT_FIELDS = [
  'first_name', 'last_name', 'company', 'email', 'phone', 'mobile', 'address', 'address2',
  'suburb', 'city', 'state', 'postcode', 'date_of_birth',
] as const;
export const AMAZON_PII_COPY_WARNING =
  'Structured fields only: notes, product descriptions, downloaded documents, carrier copies and backups are not certified as cleared.';

export class AmazonPiiValidationError extends Error {}
export class AmazonPiiConflictError extends Error {}
export class AmazonPiiNotFoundError extends Error {}

export function isAmazonPiiWriteConflict(error: unknown): boolean {
  return error instanceof Error && 'sqlState' in error && error.sqlState === '45000'
    && /^(Amazon (buyer|customer|shipment|amendment)|A cleared Amazon|Old Amazon label|Labels containing cleared Amazon|Retain the cleared Amazon)/.test(error.message);
}

export interface AmazonPiiDisposalPreview {
  businessId: string;
  salesOrderId: number;
  amazonOrderReference: string;
  earliestDeliveredAt: string | null;
  deadlineAt: string | null;
  generatedAt: string;
  expiresAt: string;
  token: string;
  blockers: string[];
  fieldsToClear: { source: string; fields: number; records: number }[];
  alreadyCleared: boolean;
  copyReviewRequired: true;
}

export interface AmazonPiiDisposalRequest {
  expectedBusinessId: string;
  salesOrderId: number;
  token: string;
  expiresAt: string;
  operationKey: string;
  confirmation: string;
}

export function validateAmazonPiiDisposalRequest(value: unknown): AmazonPiiDisposalRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AmazonPiiValidationError('Invalid cleanup request.');
  const input = value as Record<string, unknown>;
  const keys = ['expectedBusinessId', 'salesOrderId', 'token', 'expiresAt', 'operationKey', 'confirmation'];
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !(key in input))
    || typeof input.expectedBusinessId !== 'string' || !input.expectedBusinessId || input.expectedBusinessId.length > 100
    || typeof input.salesOrderId !== 'number' || !Number.isSafeInteger(input.salesOrderId) || input.salesOrderId < 1
    || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)
    || typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt))
    || typeof input.operationKey !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.operationKey)
    || input.confirmation !== `CLEAR AMAZON PII ${input.salesOrderId}`) {
    throw new AmazonPiiValidationError('Review the preview and type the exact cleanup confirmation.');
  }
  return {
    expectedBusinessId: input.expectedBusinessId, salesOrderId: input.salesOrderId, token: input.token,
    expiresAt: input.expiresAt, operationKey: input.operationKey, confirmation: input.confirmation,
  };
}

export function hasIdentifyingContactFields(contact: Record<string, unknown>): boolean {
  const name = String(contact.name ?? '').trim();
  return (name !== '' && !['Online Customer', AMAZON_CUSTOMER_LABEL].includes(name))
    || AMAZON_PII_CONTACT_FIELDS.some(key => contact[key] != null && String(contact[key]).trim() !== '');
}

const buyerContainers = new Set(['recipient', 'to', 'shippingaddress', 'buyerinfo', 'customer']);
const merchantContainers = new Set(['sender', 'from', 'account', 'merchant']);
const buyerFields = new Set([
  'name', 'firstname', 'lastname', 'company', 'email', 'emailaddress', 'phone', 'phonenumber', 'mobile',
  'address', 'address1', 'address2', 'address3', 'addressline1', 'addressline2', 'addressline3',
  'lines', 'suburb', 'city', 'state', 'stateorregion', 'postcode', 'postalcode', 'country', 'countrycode',
]);
const explicitBuyerFields = new Set([
  'buyername', 'buyeremail', 'customername', 'customeremail', 'customerphone', 'recipientname',
  'deliveryaddress', 'deliveryaddress2', 'deliverysuburb', 'deliverycity', 'deliverystate',
  'deliverypostcode', 'deliverycountry',
]);

function normalizedKey(key: string): string { return key.replace(/[_-]/g, '').toLowerCase(); }

/** Only named buyer fields are changed; product text and merchant/sender details stay intact. */
export function scrubAmazonBuyerFields(value: unknown, recipientRoot = false): { value: unknown; fields: number } {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); }
    catch { throw new Error('A stored shipping or channel snapshot is invalid; cleanup was blocked.'); }
  }
  let visited = 0;
  let fields = 0;
  function visit(node: unknown, buyer: boolean, depth: number): unknown {
    if (++visited > 20_000 || depth > 30) throw new Error('A stored snapshot exceeds the cleanup review limit.');
    if (Array.isArray(node)) return node.map(child => visit(child, buyer, depth + 1));
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).map(([key, child]) => {
      const normalized = normalizedKey(key);
      if (merchantContainers.has(normalized)) return [key, child];
      if ((buyer && buyerFields.has(normalized)) || explicitBuyerFields.has(normalized)) {
        const replacement = normalized.endsWith('name') && !['firstname', 'lastname', 'company'].includes(normalized)
          ? AMAZON_CUSTOMER_LABEL : Array.isArray(child) ? [] : '';
        if (JSON.stringify(child) !== JSON.stringify(replacement) && child !== null && child !== '') fields += 1;
        return [key, replacement];
      }
      if (normalized === 'recipientjson' && typeof child === 'string') {
        let embedded: unknown;
        try { embedded = JSON.parse(child); }
        catch { throw new Error('A stored recipient snapshot is invalid; cleanup was blocked.'); }
        return [key, JSON.stringify(visit(embedded, true, depth + 1))];
      }
      return [key, visit(child, buyer || buyerContainers.has(normalized) || normalized === 'recipientjson', depth + 1)];
    }));
  }
  const result = visit(parsed, recipientRoot, 0);
  return { value: result, fields };
}

export function validateAmazonPiiDisposalPreview(value: unknown): AmazonPiiDisposalPreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cleanup preview.');
  const result = value as Record<string, unknown>;
  if (typeof result.businessId !== 'string' || !result.businessId
    || typeof result.salesOrderId !== 'number' || !Number.isSafeInteger(result.salesOrderId) || result.salesOrderId < 1
    || typeof result.amazonOrderReference !== 'string'
    || !['generatedAt', 'expiresAt'].every(key => typeof result[key] === 'string' && Number.isFinite(Date.parse(String(result[key]))))
    || !['earliestDeliveredAt', 'deadlineAt'].every(key => result[key] === null || (typeof result[key] === 'string' && Number.isFinite(Date.parse(String(result[key])))))
    || typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token)
    || typeof result.alreadyCleared !== 'boolean' || result.copyReviewRequired !== true
    || !Array.isArray(result.blockers) || !result.blockers.every(item => typeof item === 'string')
    || !Array.isArray(result.fieldsToClear)) throw new Error('Invalid cleanup preview.');
  const fieldsToClear = result.fieldsToClear.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid cleanup counts.');
    const item = entry as Record<string, unknown>;
    if (typeof item.source !== 'string' || typeof item.fields !== 'number' || !Number.isSafeInteger(item.fields) || item.fields < 0
      || typeof item.records !== 'number' || !Number.isSafeInteger(item.records) || item.records < 0) throw new Error('Invalid cleanup counts.');
    return { source: item.source, fields: item.fields, records: item.records };
  });
  return {
    businessId: result.businessId, salesOrderId: result.salesOrderId, amazonOrderReference: result.amazonOrderReference,
    generatedAt: String(result.generatedAt), expiresAt: String(result.expiresAt), token: result.token,
    earliestDeliveredAt: result.earliestDeliveredAt === null ? null : String(result.earliestDeliveredAt),
    deadlineAt: result.deadlineAt === null ? null : String(result.deadlineAt),
    alreadyCleared: result.alreadyCleared, copyReviewRequired: true, blockers: result.blockers, fieldsToClear,
  };
}
