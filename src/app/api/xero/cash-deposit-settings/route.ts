import { NextResponse } from 'next/server';
import { assertBusinessAccess, requireAdminTier } from '@/lib/sessionUtils';
import { imsQuery } from '@/services/IMSMySQLService';
import { execute, query } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';

type CashDepositSetting = {
  ims_location_id: number;
  destination_account_id: string;
  destination_account_code: string;
  destination_account_name: string;
};

export async function GET(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const databaseId = new URL(request.url).searchParams.get('databaseId');
  const denied = assertBusinessAccess(auth.user, databaseId);
  if (denied) return denied;

  const settings = await query<CashDepositSetting>(
    `SELECT ims_location_id, destination_account_id, destination_account_code, destination_account_name
       FROM xero_cash_deposit_settings
      WHERE business_id = ?
      ORDER BY ims_location_id`,
    [databaseId],
  );
  return NextResponse.json({ success: true, settings });
}

export async function POST(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json();
  const databaseId = typeof body.databaseId === 'string' ? body.databaseId : null;
  const denied = assertBusinessAccess(auth.user, databaseId);
  if (denied) return denied;

  const locationId = Number(body.locationId);
  if (!Number.isInteger(locationId) || locationId <= 0) {
    return NextResponse.json({ success: false, error: 'locationId must be a positive integer' }, { status: 400 });
  }
  const locations = await imsQuery<{ id: number }>(
    'SELECT id FROM ims_locations WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1',
    [locationId, databaseId],
  );
  if (!locations.length) {
    return NextResponse.json({ success: false, error: 'Location does not belong to this business or is inactive' }, { status: 404 });
  }

  const accountId = typeof body.xeroAccountId === 'string' ? body.xeroAccountId.trim() : '';
  const accountCode = typeof body.xeroAccountCode === 'string' ? body.xeroAccountCode.trim() : '';
  if (!accountId && !accountCode) {
    await execute(
      'DELETE FROM xero_cash_deposit_settings WHERE business_id = ? AND ims_location_id = ?',
      [databaseId, locationId],
    );
    return NextResponse.json({ success: true, removed: true });
  }
  if (!accountId || !accountCode) {
    return NextResponse.json({ success: false, error: 'xeroAccountId and xeroAccountCode are required' }, { status: 400 });
  }

  const response = await xeroApiFetch(databaseId!, `/Accounts/${encodeURIComponent(accountId)}`);
  const account = (response?.Accounts ?? []).find((candidate: any) => candidate.AccountID === accountId);
  if (!account || account.Status !== 'ACTIVE' || account.Type !== 'BANK' || String(account.Code ?? '') !== accountCode) {
    return NextResponse.json({ success: false, error: 'Select an active Xero bank account' }, { status: 400 });
  }

  await execute(
    `INSERT INTO xero_cash_deposit_settings
       (business_id, ims_location_id, destination_account_id, destination_account_code, destination_account_name)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       destination_account_id = VALUES(destination_account_id),
       destination_account_code = VALUES(destination_account_code),
       destination_account_name = VALUES(destination_account_name),
       updated_at = NOW()`,
    [databaseId, locationId, account.AccountID, String(account.Code), account.Name ?? ''],
  );
  return NextResponse.json({ success: true });
}