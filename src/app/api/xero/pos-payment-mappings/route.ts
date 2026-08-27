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
  fee_account_code: string | null;
  fee_account_name: string | null;
  fee_tax_type: 'INPUT' | 'NONE' | null;
  deduct_fee_enabled: number;
  fixed_fee_amount: number;
  percentage_fee_rate: number;
};

const CONFIG_KEY = 'POS_PaymentMethods';
const FEE_TAX_TYPES = new Set(['INPUT', 'NONE']);

function normalizeNonNegativeAmount(value: unknown, field: string): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${field} must be zero or greater`);
  return Math.round(amount * 10000) / 10000;
}

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
      fee_account_code VARCHAR(50) DEFAULT NULL,
      fee_account_name VARCHAR(255) DEFAULT NULL,
      fee_tax_type VARCHAR(30) DEFAULT NULL,
      deduct_fee_enabled TINYINT(1) NOT NULL DEFAULT 0,
      fixed_fee_amount DECIMAL(10,4) NOT NULL DEFAULT 0,
      percentage_fee_rate DECIMAL(8,4) NOT NULL DEFAULT 0,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_xero_pos_clearing (business_id, ims_location_id, payment_method),
       INDEX idx_xero_pos_clearing_business (business_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    [],
  );
  const columns = [
    ['fee_account_code', 'VARCHAR(50) DEFAULT NULL'],
    ['fee_account_name', 'VARCHAR(255) DEFAULT NULL'],
    ['fee_tax_type', 'VARCHAR(30) DEFAULT NULL'],
    ['deduct_fee_enabled', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['fixed_fee_amount', 'DECIMAL(10,4) NOT NULL DEFAULT 0'],
    ['percentage_fee_rate', 'DECIMAL(8,4) NOT NULL DEFAULT 0'],
  ];
  for (const [columnName, definition] of columns) {
    const existing = await query<{ present: number }>(
      `SELECT 1 AS present
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'xero_pos_clearing_mappings'
          AND COLUMN_NAME = ? LIMIT 1`,
      [columnName],
    );
    if (!existing.length) {
      await execute(`ALTER TABLE xero_pos_clearing_mappings ADD COLUMN ${columnName} ${definition}`, []);
    }
  }
  await execute(
    `CREATE TABLE IF NOT EXISTS xero_pos_eod_fees (
       id BIGINT AUTO_INCREMENT PRIMARY KEY,
       business_id VARCHAR(255) NOT NULL,
       eod_reconciliation_id BIGINT NOT NULL,
       fee_amount DECIMAL(14,2) NOT NULL,
       payment_count INT NOT NULL,
       gross_amount DECIMAL(14,2) NOT NULL,
       clearing_account_code VARCHAR(50) NOT NULL,
       fee_account_code VARCHAR(50) NOT NULL,
       fee_tax_type VARCHAR(30) NOT NULL,
       status VARCHAR(30) NOT NULL DEFAULT 'pending',
       xero_bank_transaction_id VARCHAR(100) DEFAULT NULL,
       error_detail TEXT DEFAULT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_xero_pos_eod_fee (business_id, eod_reconciliation_id)
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
        `SELECT ims_location_id, payment_method, xero_account_id, xero_account_code, xero_account_name,
          fee_account_code, fee_account_name, fee_tax_type, deduct_fee_enabled,
          fixed_fee_amount, percentage_fee_rate
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
    if (!accountId) {
      return NextResponse.json({ success: false, error: 'Select a Xero account' }, { status: 400 });
    }
    if (!accountCode) {
      return NextResponse.json({ success: false, error: 'This Xero account has no account code. Add a unique code in Xero, refresh Xero accounts, then map it again.' }, { status: 400 });
    }

    const feeTaxType = String(body.feeTaxType ?? 'NONE').trim().toUpperCase();
    if (!FEE_TAX_TYPES.has(feeTaxType)) {
      return NextResponse.json({ success: false, error: 'feeTaxType must be INPUT or NONE' }, { status: 400 });
    }
    const deductFeeEnabled = body.deductFeeEnabled === true;
    const fixedFeeAmount = normalizeNonNegativeAmount(body.fixedFeeAmount, 'fixedFeeAmount');
    const percentageFeeRate = normalizeNonNegativeAmount(body.percentageFeeRate, 'percentageFeeRate');
    if (percentageFeeRate > 100) {
      return NextResponse.json({ success: false, error: 'percentageFeeRate must not exceed 100' }, { status: 400 });
    }
    const feeAccountCode = typeof body.feeAccountCode === 'string' ? body.feeAccountCode.trim() : '';
    if (deductFeeEnabled && !feeAccountCode) {
      return NextResponse.json({ success: false, error: 'Select a fee expense account when calculated fees are enabled' }, { status: 400 });
    }

    const accountResponse = await xeroApiFetch(databaseId, '/Accounts');
    const account = (accountResponse?.Accounts ?? []).find((candidate: any) => candidate.AccountID === accountId);
    const acceptsPayments = account?.Type === 'BANK' || account?.EnablePaymentsToAccount === true;
    if (!account || account.Status !== 'ACTIVE' || !acceptsPayments || String(account.Code ?? '') !== accountCode) {
      return NextResponse.json({ success: false, error: 'Select an active Xero account that accepts payments' }, { status: 400 });
    }
    const feeAccount = feeAccountCode
      ? (accountResponse?.Accounts ?? []).find((candidate: any) => String(candidate.Code ?? '') === feeAccountCode)
      : null;
    if (deductFeeEnabled && (!feeAccount || feeAccount.Status !== 'ACTIVE' || feeAccount.Class !== 'EXPENSE')) {
      return NextResponse.json({ success: false, error: 'Select an active Xero expense account for calculated fees' }, { status: 400 });
    }

    await execute(
      `INSERT INTO xero_pos_clearing_mappings
         (business_id, ims_location_id, payment_method, xero_account_id, xero_account_code, xero_account_name,
          fee_account_code, fee_account_name, fee_tax_type, deduct_fee_enabled, fixed_fee_amount, percentage_fee_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         xero_account_id = VALUES(xero_account_id),
         xero_account_code = VALUES(xero_account_code),
         xero_account_name = VALUES(xero_account_name),
         fee_account_code = VALUES(fee_account_code),
         fee_account_name = VALUES(fee_account_name),
         fee_tax_type = VALUES(fee_tax_type),
         deduct_fee_enabled = VALUES(deduct_fee_enabled),
         fixed_fee_amount = VALUES(fixed_fee_amount),
         percentage_fee_rate = VALUES(percentage_fee_rate),
         updated_at = NOW()`,
      [databaseId, locationId, canonicalMethod, account.AccountID, String(account.Code), account.Name ?? null,
       feeAccount ? String(feeAccount.Code) : null, feeAccount?.Name ?? null, feeTaxType,
       deductFeeEnabled ? 1 : 0, fixedFeeAmount, percentageFeeRate],
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const message = error?.message ?? 'Failed to save POS clearing mapping';
    const status = /^(fixedFeeAmount|percentageFeeRate)/.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}