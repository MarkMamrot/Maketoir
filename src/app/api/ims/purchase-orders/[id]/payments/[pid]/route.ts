import { NextRequest, NextResponse } from 'next/server';
import { ImsPORepo } from '@/lib/ims/ImsRepository';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; pid: string } }) {
  try {
    await ImsPORepo.deletePayment(Number(params.pid));
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
