/**
 * GET  /api/xero/tracking?databaseId=xxx  — Fetch tracking categories from Xero
 * POST /api/xero/tracking                 — Save tracking mapping
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

  // Always fetch saved mappings from DB (works even if Xero API is down)
  let mappings: any[] = [];
  try {
    mappings = await query(
      `SELECT ims_location_id, ims_channel, xero_tracking_category_id, xero_tracking_option_id, xero_tracking_option_name
       FROM xero_tracking_mappings WHERE business_id = ?`,
      [databaseId],
    );
  } catch {}

  try {
    // Fetch tracking categories from Xero
    const data = await xeroApiFetch(databaseId!, '/TrackingCategories');
    const categories = (data.TrackingCategories ?? []).map((tc: any) => ({
      trackingCategoryId: tc.TrackingCategoryID,
      name: tc.Name,
      status: tc.Status,
      options: (tc.Options ?? []).map((o: any) => ({
        trackingOptionId: o.TrackingOptionID,
        name: o.Name,
        status: o.Status,
      })),
    }));

    return NextResponse.json({ categories, mappings });
  } catch (err: any) {
    console.error('[xero/tracking GET]', err.message);
    // Return saved mappings even if Xero API fails
    return NextResponse.json({ categories: [], mappings, xeroError: err.message });
  }
}

export async function POST(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  const body = await req.json();
  const { databaseId, imsLocationId, imsChannel, xeroCategoryId, xeroOptionId, xeroOptionName } = body;
  const denied = assertBusinessAccess(user, databaseId);
  if (denied) return denied;

  if (!xeroCategoryId || !xeroOptionId) {
    return NextResponse.json({ error: 'Tracking category and option are required.' }, { status: 400 });
  }

  try {
    await execute(
      `INSERT INTO xero_tracking_mappings
        (business_id, ims_location_id, ims_channel, xero_tracking_category_id, xero_tracking_option_id, xero_tracking_option_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        xero_tracking_category_id = VALUES(xero_tracking_category_id),
        xero_tracking_option_id = VALUES(xero_tracking_option_id),
        xero_tracking_option_name = VALUES(xero_tracking_option_name),
        updated_at = NOW()`,
      [databaseId, imsLocationId ?? null, imsChannel ?? null, xeroCategoryId, xeroOptionId, xeroOptionName ?? null],
    );
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[xero/tracking POST]', err.message);
    return NextResponse.json({ error: 'Failed to save tracking mapping.' }, { status: 500 });
  }
}
