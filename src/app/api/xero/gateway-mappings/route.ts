/**
 * /api/xero/gateway-mappings
 *
 * GET  — list all gateway mappings for the current business.
 * POST — upsert a mapping { gateway_name, display_name, clearing_account_code,
 *         clearing_account_name, fee_account_code, fee_account_name }
 * DELETE ?gateway_name=xxx — remove a mapping.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, execute } from '@/services/MySQLService';
import { assertBusinessAccess, requireAdminSession } from '@/lib/sessionUtils';

const FEE_TAX_TYPES = new Set(['INPUT', 'NONE']);

function normalizeNonNegativeAmount(value: unknown, field: string): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${field} must be zero or greater`);
  return Math.round(amount * 10000) / 10000;
}

function normalizeFeeTaxType(value: unknown): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!FEE_TAX_TYPES.has(normalized)) {
    throw new Error('fee_tax_type must be INPUT or NONE');
  }
  return normalized;
}

export async function GET(req: NextRequest) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;
  const bid = req.nextUrl.searchParams.get('databaseId') ?? auth.user!.businessId;
  const denied = assertBusinessAccess(auth.user!, bid);
  if (denied) return denied;
  try {
    const rows = await query(
      `SELECT id, gateway_name, display_name, clearing_account_code, clearing_account_name,
              fee_account_code, fee_account_name, fee_tax_type,
              deduct_fee_enabled, fixed_fee_amount, percentage_fee_rate
         FROM xero_gateway_mappings WHERE business_id = ? ORDER BY display_name`,
      [bid],
    );
    return NextResponse.json({ success: true, mappings: rows });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;
  const bid = auth.user!.businessId;
  const body = await req.json();
  const { gateway_name, display_name, clearing_account_code, clearing_account_name, fee_account_code, fee_account_name } = body;
  if (!gateway_name) return NextResponse.json({ error: 'gateway_name required' }, { status: 400 });
  try {
    const feeTaxType = normalizeFeeTaxType(body.fee_tax_type);
    const normalizedGateway = String(gateway_name).trim().toLowerCase();
    const feeExcluded = normalizedGateway.includes('shopify_payment') || normalizedGateway.includes('paypal');
    const deductFeeEnabled = !feeExcluded && body.deduct_fee_enabled === true;
    const fixedFeeAmount = normalizeNonNegativeAmount(body.fixed_fee_amount, 'fixed_fee_amount');
    const percentageFeeRate = normalizeNonNegativeAmount(body.percentage_fee_rate, 'percentage_fee_rate');
    if (percentageFeeRate > 100) throw new Error('percentage_fee_rate must not exceed 100');
    if (deductFeeEnabled && !fee_account_code) {
      throw new Error('fee_account_code is required when fee deduction is enabled');
    }
    await execute(
      `INSERT INTO xero_gateway_mappings
         (business_id, gateway_name, display_name, clearing_account_code, clearing_account_name,
          fee_account_code, fee_account_name, fee_tax_type, deduct_fee_enabled, fixed_fee_amount, percentage_fee_rate)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         clearing_account_code = VALUES(clearing_account_code),
         clearing_account_name = VALUES(clearing_account_name),
         fee_account_code = VALUES(fee_account_code),
         fee_account_name = VALUES(fee_account_name),
         fee_tax_type = VALUES(fee_tax_type),
         deduct_fee_enabled = VALUES(deduct_fee_enabled),
         fixed_fee_amount = VALUES(fixed_fee_amount),
         percentage_fee_rate = VALUES(percentage_fee_rate)`,
      [bid, normalizedGateway, display_name ?? gateway_name,
       clearing_account_code ?? null, clearing_account_name ?? null,
       fee_account_code ?? null, fee_account_name ?? null, feeTaxType,
       deductFeeEnabled ? 1 : 0, fixedFeeAmount, percentageFeeRate],
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    const status = /^(fee_tax_type|fixed_fee_amount|percentage_fee_rate|fee_account_code)/.test(e.message ?? '') ? 400 : 500;
    return NextResponse.json({ success: false, error: e.message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = requireAdminSession();
  if (auth.response) return auth.response;
  const bid = auth.user!.businessId;
  const gateway_name = req.nextUrl.searchParams.get('gateway_name');
  if (!gateway_name) return NextResponse.json({ error: 'gateway_name required' }, { status: 400 });
  try {
    await execute(
      `DELETE FROM xero_gateway_mappings WHERE business_id = ? AND gateway_name = ?`,
      [bid, String(gateway_name).toLowerCase()],
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
