import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { triggerPOXeroSync, triggerPOXeroVoid, triggerPOXeroUpdate } from '@/lib/ims/xeroHooks';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const data = await ImsPORepo.get(Number(params.id), businessId);
    if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, status, ...poData } = body;

    // Handle status transition
    let xeroWarning: string | null = null;
    if (status) {
      // Fetch freight treatment setting for this business
      let freightTreatment: 'expense' | 'capitalise' = 'expense';
      try {
        const rows = await imsQuery<{ value: string }>(
          `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = 'freight_treatment' LIMIT 1`,
          [businessId]
        );
        if (rows[0]?.value === 'capitalise') freightTreatment = 'capitalise';
      } catch {}

      // Capture prior status before changeStatus to detect received → ordered revert
      const priorPo = await ImsPORepo.get(Number(params.id), businessId);

      await ImsPORepo.changeStatus(Number(params.id), status, freightTreatment);

      // EVENT-DRIVEN CACHE UPDATE: update global_incoming and stock fields on PO changes
      const poDataFull = await ImsPORepo.get(Number(params.id), businessId);
      if (poDataFull && (poDataFull.items?.length ?? 0) > 0) {
        const vids = poDataFull.items!.map(i => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO:', err));
        }
      }

      // Await void for revert/cancel; fire Xero sync on ordered/received; skip if bill already exists
      if (status === 'cancelled') {
        xeroWarning = await triggerPOXeroVoid(businessId, Number(params.id)).catch(() => null);
      } else if (status === 'draft') {
        // Revert to draft → void existing Xero bill (triggerPOXeroVoid also clears xero_bill_id)
        xeroWarning = await triggerPOXeroVoid(businessId, Number(params.id)).catch(() => null);
      } else if (status === 'ordered') {
        if (priorPo?.status === 'received') {
          // Reverting from received: void the AUTHORISED Xero bill, then create a new Draft
          xeroWarning = await triggerPOXeroVoid(businessId, Number(params.id)).catch(() => null);
          // xero_bill_id is now cleared — create a fresh Draft Bill
          triggerPOXeroSync(businessId, Number(params.id), 'ordered').catch(() => {});
        } else {
          // Normal ordered: create Draft Bill if none exists yet
          const hasExistingBill = !!(poDataFull as any)?.xero_bill_id;
          if (!hasExistingBill) {
            triggerPOXeroSync(businessId, Number(params.id), 'ordered').catch(() => {});
          }
        }
      } else if (status === 'received') {
        // Only fire sync on full receive via IMS list (batch API fires its own sync)
        triggerPOXeroSync(businessId, Number(params.id), status).catch(() => {});
      }
      // 'partially_received' → no Xero action (not fully received yet)

    } else {
      const existing = await ImsPORepo.get(Number(params.id), businessId);
      if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      const { landed_costs, ...cleanPoData } = poData;
      await ImsPORepo.update(Number(params.id), cleanPoData, items, landed_costs);

      // EVENT-DRIVEN CACHE UPDATE
      if (items && items.length > 0) {
        const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
        if (vids.length > 0) {
          refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO:', err));
        }
      }

      // Sync edits to Xero if a Draft Bill already exists
      triggerPOXeroUpdate(businessId, Number(params.id)).catch(() => {});
    }
    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const existing = await ImsPORepo.get(Number(params.id), businessId);
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    // Void the Xero bill before deleting (if one exists)
    const xeroWarning = await triggerPOXeroVoid(businessId, Number(params.id)).catch(() => null);

    await ImsPORepo.delete(Number(params.id));

    // EVENT-DRIVEN CACHE UPDATE (Deletion reverses incoming stock)
    if (existing && (existing.items?.length ?? 0) > 0) {
      const vids = existing.items!.map(i => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO deletion:', err));
      }
    }

    return NextResponse.json({ success: true, ...(xeroWarning ? { xeroWarning } : {}) });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
