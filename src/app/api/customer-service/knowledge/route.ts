import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { getCustomerServiceKnowledge, saveCustomerServiceKnowledge } from '@/lib/customer-service/repository';

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    return NextResponse.json({ success: true, documents: await getCustomerServiceKnowledge(user.businessId) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const body = await req.json();
    if (body.documentKey !== 'style' && body.documentKey !== 'knowledge') {
      return NextResponse.json({ success: false, error: 'Invalid documentKey' }, { status: 400 });
    }
    const version = await saveCustomerServiceKnowledge({
      businessId: user.businessId,
      documentKey: body.documentKey,
      markdown: String(body.markdown ?? ''),
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      userId: user.userId,
    });
    return NextResponse.json({ success: true, version });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}