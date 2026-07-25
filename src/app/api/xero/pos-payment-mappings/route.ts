import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { query, execute } from '@/services/MySQLService';
import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { xeroApiFetch } from '@/services/XeroService';

type ClearingMappingRow = {
  ims_location_id: number;
  payment_method: string;
  xero_account_id: string;
  xero_account_code: string;
  xero_account_name: string | null;
};

const CONFIG_KEY = 'POS_PaymentMethods';

function normalizeMethodName(value: string): string {
  return value.trim().toLowerCase();
}

function extractMethodName(input: unknown): string | null {
  if (typeof input === 'string') {
    const value = input.trim();
    return value || null;
  }
  if (input && typeof input === 'object' && 'name' in input && typeof (input as { name?: unknown }).name === 'string') {
    const value = (input as { name: string }).name.trim();
    return value || null;
  }
  return null;
}

async function getConfiguredMethods(businessId: string): Promise<string[]> {
  const rawMethods = await ConfigRepository.get(businessId, CONFIG_KEY);
  const parsedMethods = rawMethods ? JSON.parse(rawMethods) : [];
  if (!Array.isArray(parsedMethods)) return [];

  const seen = new Set<string>();
  const methods: string[] = [];
  for (const item of parsedMethods) {
    const name = extractMethodName(item);
    if (!name) continue;
    const key = normalizeMethodName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    methods.push(name);
  }
  return methods;
}

async function ensureTable(): Promise<void> {
  await execute(
    `CREATE TABLE IF NOT EXISTS xero_pos_clearing_mappings (
       id BIGINT AUTO_INCREMENT PRIMARY KEY,
       business_id VARCHAR(255) NOT NULL,
       ims_location_id INT NOT NULL,
       payment_method VARCHAR(255) NOT NULL,
       xero_account_id VARCHAR(100) NOT NULL,
       xero_account_code VARCHAR(20) NOT NULL,
       xero_account_name VARCHAR(255) DEFAULT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_xero_pos_clearing (business_id, ims_location_id, payment_method),
       INDEX idx_xero_pos_clearing_business (business_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    [],
  );
}

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const databaseId = new URL(req.url).searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required' }, { status: 400 });
  }

  try {
    await ensureTable();
    const [methods, locations, mappings] = await Promise.all([
      getConfiguredMethods(databaseId),
      imsQuery<{ id: number; name: string }>(
        'SELECT id, name FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name',
        [databaseId],
      ),
      query<ClearingMappingRow>(
        `SELECT ims_location_id, payment_method, xero_account_id, xero_account_code, xero_account_name
           FROM xero_pos_clearing_mappings
          WHERE business_id = ?`,
        [databaseId],
      ),
    ]);

    return NextResponse.json({
      success: true,
      methods: methods.map(payment_method => ({ payment_method })),
      locations,
      mappings,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message ?? 'Failed to load POS clearing mappings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const body = await req.json();
  const databaseId = typeof body.databaseId === 'string' ? body.databaseId : null;
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;
  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required' }, { status: 400 });
  }

  const locationId = Number(body.locationId);
  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod.trim() : '';
  if (!Number.isInteger(locationId) || locationId <= 0) {
    return NextResponse.json({ success: false, error: 'locationId must be a positive integer' }, { status: 400 });
  }
  if (!paymentMethod) {
    return NextResponse.json({ success: false, error: 'paymentMethod is required' }, { status: 400 });
  }

  try {
    await ensureTable();
    const locations = await imsQuery<{ id: number }>(
      'SELECT id FROM ims_locations WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
      [locationId, databaseId],
    );
    if (!locations.length) {
      return NextResponse.json({ success: false, error: 'Location does not belong to this business or is inactive' }, { status: 404 });
    }

    const configuredMethods = await getConfiguredMethods(databaseId);
    const canonicalMethod = configuredMethods.find(method => normalizeMethodName(method) === normalizeMethodName(paymentMethod));
    if (!canonicalMethod) {
      return NextResponse.json({ success: false, error: 'Payment method is not configured for this business' }, { status: 400 });
    }

    const accountId = typeof body.xeroAccountId === 'string' ? body.xeroAccountId.trim() : '';
    const accountCode = typeof body.xeroAccountCode === 'string' ? body.xeroAccountCode.trim() : '';
    if (!accountId && !accountCode) {
      await execute(
        `DELETE FROM xero_pos_clearing_mappings
          WHERE business_id = ? AND ims_location_id = ? AND LOWER(payment_method) = ?`,
        [databaseId, locationId, normalizeMethodName(canonicalMethod)],
      );
      return NextResponse.json({ success: true, removed: true });
    }
    if (!accountId || !accountCode) {
      return NextResponse.json({ success: false, error: 'xeroAccountId and xeroAccountCode are required' }, { status: 400 });
    }

    const accountResponse = await xeroApiFetch(databaseId, `/Accounts/${encodeURIComponent(accountId)}`);
    const account = (accountResponse?.Accounts ?? []).find((candidate: any) => candidate.AccountID === accountId);
    if (!account || account.Status !== 'ACTIVE' || account.Type !== 'BANK' || String(account.Code ?? '') !== accountCode) {
      return NextResponse.json({ success: false, error: 'Select an active Xero bank account' }, { status: 400 });
    }

    await execute(
      `INSERT INTO xero_pos_clearing_mappings
         (business_id, ims_location_id, payment_method, xero_account_id, xero_account_code, xero_account_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         xero_account_id = VALUES(xero_account_id),
         xero_account_code = VALUES(xero_account_code),
         xero_account_name = VALUES(xero_account_name),
         updated_at = NOW()`,
      [databaseId, locationId, canonicalMethod, account.AccountID, String(account.Code), account.Name ?? null],
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message ?? 'Failed to save POS clearing mapping' }, { status: 500 });
  }
}