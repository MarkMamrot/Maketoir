import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsBTRepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getImsSession } from '@/lib/auth/imsSession';
import { verifyManagerPin } from '@/lib/pos/managerPin';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

const IMS_OR_POS_SESSION = ['marketoir_session', 'pos_session'];

function readPosSession(): any | null {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeBtAccess(value: unknown): 'disabled' | 'manager' | 'all' {
  return value === 'disabled' || value === 'manager' ? value : 'all';
}

export async function GET(req: Request) {
  const session = await getImsSession(IMS_OR_POS_SESSION);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const status = statusParam
      ? (statusParam.includes(',') ? statusParam.split(',') as any[] : statusParam as any)
      : undefined;
    const data = await ImsBTRepo.list(session.businessId, status);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const posSession = readPosSession();
  const session = await getImsSession(posSession ? ['pos_session'] : ['marketoir_session']);
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  let operationContext: Record<string, unknown> = {};
  try {
    const body = await req.json();
    const { items, ...btData } = body;
    let id: number;

    if (posSession) {
      const sourceLocationId = Number(posSession.location_id);
      const requestedSourceId = Number(body.from_location_id);
      const destinationLocationId = Number(body.to_location_id);
      operationContext = {
        sourceLocationId,
        destinationLocationId,
        itemCount: Array.isArray(items) ? items.length : 0,
      };
      if (!sourceLocationId) {
        return NextResponse.json({ success: false, error: 'No POS location in session.' }, { status: 400 });
      }
      if (requestedSourceId && requestedSourceId !== sourceLocationId) {
        return NextResponse.json({ success: false, error: 'Transfer source must match the current POS location.' }, { status: 403 });
      }
      if (!destinationLocationId || destinationLocationId === sourceLocationId) {
        return NextResponse.json({ success: false, error: 'Select a different destination location.' }, { status: 400 });
      }

      const accessRows = await imsQuery<{ value: string }>(
        "SELECT value FROM ims_settings WHERE business_id = ? AND `key` = 'pos_bt_access' LIMIT 1",
        [session.businessId],
      );
      const access = normalizeBtAccess(accessRows[0]?.value);
      if (access === 'disabled') {
        return NextResponse.json({ success: false, error: 'Branch transfer creation is disabled in POS.' }, { status: 403 });
      }
      if (access === 'manager') {
        const pinResult = await verifyManagerPin(sourceLocationId, body.manager_pin);
        if (!pinResult.ok) {
          return NextResponse.json({ success: false, error: pinResult.error }, { status: pinResult.status });
        }
      }

      const locationRows = await imsQuery<{ id: number }>(
        `SELECT id FROM ims_locations
         WHERE business_id = ? AND is_active = 1 AND id IN (?, ?)`,
        [session.businessId, sourceLocationId, destinationLocationId],
      );
      if (new Set(locationRows.map(row => Number(row.id))).size !== 2) {
        return NextResponse.json({ success: false, error: 'Source or destination location is unavailable.' }, { status: 400 });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ success: false, error: 'Add at least one transfer item.' }, { status: 400 });
      }
      const variantIds = items.map((item: any) => String(item.variant_id ?? '').trim());
      if (variantIds.some((id: string) => !id) || new Set(variantIds).size !== variantIds.length) {
        return NextResponse.json({ success: false, error: 'Transfer items must contain unique valid variants.' }, { status: 400 });
      }
      if (items.some((item: any) => !Number.isInteger(Number(item.qty_sent)) || Number(item.qty_sent) <= 0)) {
        return NextResponse.json({ success: false, error: 'Transfer quantities must be positive whole numbers.' }, { status: 400 });
      }

      const placeholders = variantIds.map(() => '?').join(',');
      const variantRows = await imsQuery<{ variant_id: string; cost_aud: number | null }>(
        `SELECT variant_id, cost_aud FROM ims_product_variants
         WHERE business_id = ? AND variant_id IN (${placeholders})`,
        [session.businessId, ...variantIds],
      );
      if (variantRows.length !== variantIds.length) {
        return NextResponse.json({ success: false, error: 'One or more transfer items are unavailable.' }, { status: 400 });
      }
      const costs = new Map(variantRows.map(row => [String(row.variant_id), Number(row.cost_aud ?? 0)]));
      const normalizedItems = items.map((item: any) => ({
        variant_id: String(item.variant_id),
        qty_sent: Number(item.qty_sent),
        unit_cost: costs.get(String(item.variant_id)) ?? 0,
        notes: String(item.notes ?? '').slice(0, 500),
      }));
      id = await ImsBTRepo.createSent({
        from_location_id: sourceLocationId,
        to_location_id: destinationLocationId,
        transfer_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Australia/Sydney' }),
        notes: String(body.notes ?? '').trim().slice(0, 2000) || undefined,
      }, normalizedItems, session.businessId);
    } else {
      id = await ImsBTRepo.create(btData, items ?? [], session.businessId);
    }

    // EVENT-DRIVEN CACHE UPDATE (Creation affects committed stock)
    if (items && items.length > 0) {
      const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for BT creation:', err));
      }
    }

    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'pos.branch-transfer',
      operation: posSession ? 'create-and-send' : 'create-draft',
      title: posSession ? 'POS branch transfer creation failed' : 'IMS branch transfer creation failed',
      error: e,
      context: operationContext,
    });
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
