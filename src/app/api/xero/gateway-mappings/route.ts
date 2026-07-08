/**
 * /api/xero/gateway-mappings
 *
 * GET  — list all gateway mappings for the current business.
 * POST — upsert a mapping { gateway_name, display_name, clearing_account_code,
 *         clearing_account_name, fee_account_code, fee_account_name }
 * DELETE ?gateway_name=xxx — remove a mapping.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { query, execute } from '@/services/MySQLService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const session = getSession();
  const bid = req.nextUrl.searchParams.get('databaseId') ?? session?.businessId ?? '';
  if (!bid) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const rows = await query(
      `SELECT id, gateway_name, display_name, clearing_account_code, clearing_account_name,
              fee_account_code, fee_account_name
         FROM xero_gateway_mappings WHERE business_id = ? ORDER BY display_name`,
      [bid],
    );
    return NextResponse.json({ success: true, mappings: rows });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const bid = session.businessId as string;
  const body = await req.json();
  const { gateway_name, display_name, clearing_account_code, clearing_account_name, fee_account_code, fee_account_name } = body;
  if (!gateway_name) return NextResponse.json({ error: 'gateway_name required' }, { status: 400 });
  try {
    await execute(
      `INSERT INTO xero_gateway_mappings
         (business_id, gateway_name, display_name, clearing_account_code, clearing_account_name, fee_account_code, fee_account_name)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         clearing_account_code = VALUES(clearing_account_code),
         clearing_account_name = VALUES(clearing_account_name),
         fee_account_code = VALUES(fee_account_code),
         fee_account_name = VALUES(fee_account_name)`,
      [bid, String(gateway_name).toLowerCase(), display_name ?? gateway_name,
       clearing_account_code ?? null, clearing_account_name ?? null,
       fee_account_code ?? null, fee_account_name ?? null],
    );
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const bid = session.businessId as string;
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
