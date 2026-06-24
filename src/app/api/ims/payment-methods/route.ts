import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsPaymentMethodsRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET(_req: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(_req.url);
    const type = searchParams.get('type') as 'po' | 'so' | null;
    const methods = await ImsPaymentMethodsRepo.list(session.businessId, type ?? undefined);
    return NextResponse.json({ success: true, data: methods });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const { name, type, xero_account_code, sort_order } = body;
    if (!name?.trim()) return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    if (type !== 'po' && type !== 'so') return NextResponse.json({ success: false, error: 'type must be po or so' }, { status: 400 });
    const method = await ImsPaymentMethodsRepo.create(session.businessId, { name: name.trim(), type, xero_account_code, sort_order });
    return NextResponse.json({ success: true, data: method });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const { id, ...data } = body;
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    await ImsPaymentMethodsRepo.update(Number(id), session.businessId, data);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    await ImsPaymentMethodsRepo.delete(Number(id), session.businessId);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
