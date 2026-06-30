import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosSalesRepo } from '@/lib/db/PosRepository';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// POST /api/pos/sales/[id]/payments — add a payment to an existing sale
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!getPosSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const saleId = parseInt(params.id, 10);
  if (isNaN(saleId)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  try {
    const { payment_method, amount, reference } = await req.json();
    if (!payment_method || amount == null) {
      return NextResponse.json({ error: 'payment_method and amount are required.' }, { status: 400 });
    }
    await PosSalesRepo.addPaymentToSale(saleId, { payment_method, amount: Number(amount), reference });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POS payment add error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}

// PUT /api/pos/sales/[id]/payments — replace payment split (total must remain unchanged)
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!getPosSession()) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const saleId = parseInt(params.id, 10);
  if (isNaN(saleId)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  try {
    const { payments } = await req.json();
    if (!Array.isArray(payments) || payments.length === 0) {
      return NextResponse.json({ error: 'payments array is required.' }, { status: 400 });
    }
    for (const p of payments) {
      if (!p.payment_method || typeof p.payment_method !== 'string' || p.amount == null) {
        return NextResponse.json({ error: 'Each payment must have payment_method and amount.' }, { status: 400 });
      }
    }
    const normalised = payments.map((p: any) => ({ payment_method: String(p.payment_method).trim(), amount: Number(p.amount) }));
    await PosSalesRepo.updatePaymentSplit(saleId, normalised);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POS payment split update error:', err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
