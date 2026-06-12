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
