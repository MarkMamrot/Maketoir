/**
 * GET  /api/xero/accounts?databaseId=xxx  — Fetch chart of accounts from Xero
 * POST /api/xero/accounts                 — Save account mapping
 * 
 * The GET pulls the full chart of accounts from Xero so the UI can populate dropdowns.
 * The POST saves a role→account mapping to xero_account_mappings table.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession, assertBusinessAccess } from '@/lib/sessionUtils';
import { xeroApiFetch } from '@/services/XeroService';
import { query, execute } from '@/services/MySQLService';

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const databaseId = searchParams.get('databaseId');
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  try {
    // Fetch accounts from Xero
    const data = await xeroApiFetch(databaseId!, '/Accounts');
    const accounts = (data.Accounts ?? []).map((a: any) => ({
      accountId: a.AccountID,
      code: a.Code,
      name: a.Name,
      type: a.Type,
      class: a.Class,
      status: a.Status,
    })).filter((a: any) => a.status === 'ACTIVE');

    // Also fetch saved mappings from DB
    const mappings = await query(
      'SELECT role_key, xero_account_id, xero_account_code, xero_account_name FROM xero_account_mappings WHERE business_id = ?',
      [databaseId],
    );

    return NextResponse.json({ accounts, mappings });
  } catch (err: any) {
    console.error('[xero/accounts GET]', err.message);
    return NextResponse.json({ error: 'Failed to fetch Xero accounts.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const body = await req.json();
  const { databaseId, roleKey, xeroAccountId, xeroAccountCode, xeroAccountName } = body;
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  const validRoles = ['inventory_asset', 'inventory_in_transit', 'cogs', 'sales_revenue', 'freight'];
  if (!validRoles.includes(roleKey)) {
    return NextResponse.json({ error: 'Invalid role_key.' }, { status: 400 });
  }

  try {
    await execute(
      `INSERT INTO xero_account_mappings (business_id, role_key, xero_account_id, xero_account_code, xero_account_name)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE xero_account_id = VALUES(xero_account_id),
         xero_account_code = VALUES(xero_account_code),
         xero_account_name = VALUES(xero_account_name),
         updated_at = NOW()`,
      [databaseId, roleKey, xeroAccountId, xeroAccountCode, xeroAccountName],
    );
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[xero/accounts POST]', err.message);
    return NextResponse.json({ error: 'Failed to save mapping.' }, { status: 500 });
  }
}
