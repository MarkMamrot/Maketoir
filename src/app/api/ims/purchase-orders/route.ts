import { NextResponse } from 'next/server';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getImsSession } from '@/lib/auth/imsSession';
import { resolveEarlyPaymentDiscountOrderSnapshot } from '@/lib/ims/earlyPaymentDiscountRules';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') as any ?? undefined;
    const data = await ImsPORepo.list(status, businessId);
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, landed_costs, early_payment_discount_selection, ...poData } = body;
    const discountSnapshot = await resolveEarlyPaymentDiscountOrderSnapshot({
      businessId, documentType: 'purchase_order', contactId: poData.supplier_id,
      orderDate: poData.order_date, supplierInvoiceDate: poData.supplier_invoice_date,
      selection: early_payment_discount_selection,
    });
    const id = await ImsPORepo.create({ ...poData, ...discountSnapshot }, items ?? [], landed_costs ?? [], businessId);

    // EVENT-DRIVEN CACHE UPDATE (Creation affects incoming stock)
    if (items && items.length > 0) {
      const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for PO creation:', err));
      }
    }

    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
