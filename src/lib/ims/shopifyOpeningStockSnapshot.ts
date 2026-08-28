import { createHmac, timingSafeEqual } from 'crypto';

import { SHOPIFY_OPENING_STOCK_LOCATION_NAMES } from './shopifyOpeningStock';

export interface OpeningStockSnapshotLine {
  variantId: string;
  locationName: string;
  solvantisLocationId: number;
  quantity: number;
  wasNegative: boolean;
}

export interface OpeningStockSnapshot {
  version: 1;
  businessId: string;
  offset: number;
  expiresAt: number;
  lines: OpeningStockSnapshotLine[];
}

function signingSecret(): string {
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SESSION_SECRET || '';
  if (!secret) throw new Error('Opening stock snapshot signing is not configured.');
  return secret;
}

function signature(payload: string): Buffer {
  return createHmac('sha256', signingSecret()).update(`shopify-opening-stock:${payload}`).digest();
}

function validSnapshot(value: unknown): value is OpeningStockSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as OpeningStockSnapshot;
  if (!Array.isArray(snapshot.lines) || snapshot.lines.length < 2 || snapshot.lines.length > 20) return false;
  const locationNames = new Set<string>(SHOPIFY_OPENING_STOCK_LOCATION_NAMES);
  const variantIds = new Set(snapshot.lines.map(line => line?.variantId));
  const lineKeys = new Set(snapshot.lines.map(line => `${line?.variantId}:${line?.locationName}`));
  const everyVariantHasBothLocations = [...variantIds].every(variantId =>
    SHOPIFY_OPENING_STOCK_LOCATION_NAMES.every(locationName => lineKeys.has(`${variantId}:${locationName}`)),
  );
  return snapshot.version === 1
    && typeof snapshot.businessId === 'string' && snapshot.businessId.length > 0
    && Number.isInteger(snapshot.offset) && snapshot.offset >= 0
    && Number.isFinite(snapshot.expiresAt)
    && variantIds.size >= 1 && variantIds.size <= 10
    && lineKeys.size === snapshot.lines.length
    && snapshot.lines.length === variantIds.size * SHOPIFY_OPENING_STOCK_LOCATION_NAMES.length
    && everyVariantHasBothLocations
    && snapshot.lines.every(line =>
      line && typeof line.variantId === 'string' && line.variantId.length > 0
      && locationNames.has(line.locationName)
      && Number.isInteger(line.solvantisLocationId) && line.solvantisLocationId > 0
      && Number.isFinite(line.quantity) && line.quantity >= 0
      && typeof line.wasNegative === 'boolean'
    );
}

export function signOpeningStockSnapshot(snapshot: OpeningStockSnapshot): string {
  if (!validSnapshot(snapshot)) throw new Error('Opening stock snapshot is invalid.');
  const payload = Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function verifyOpeningStockSnapshot(
  token: unknown,
  businessId: string,
  now = Date.now(),
): OpeningStockSnapshot {
  const [payload, encodedSignature, ...rest] = String(token ?? '').split('.');
  if (!payload || !encodedSignature || rest.length > 0) throw new Error('Opening stock preview is invalid. Preview again.');

  const expected = signature(payload);
  let actual: Buffer;
  try { actual = Buffer.from(encodedSignature, 'base64url'); } catch { throw new Error('Opening stock preview is invalid. Preview again.'); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Opening stock preview is invalid. Preview again.');
  }

  let snapshot: unknown;
  try { snapshot = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new Error('Opening stock preview is invalid. Preview again.'); }
  if (!validSnapshot(snapshot) || snapshot.businessId !== businessId) {
    throw new Error('Opening stock preview does not belong to this business. Preview again.');
  }
  if (snapshot.expiresAt < now) throw new Error('Opening stock preview has expired. Preview again.');
  return snapshot;
}