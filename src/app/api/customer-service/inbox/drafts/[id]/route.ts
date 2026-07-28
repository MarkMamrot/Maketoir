import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { updateCustomerServiceDraft } from '@/lib/customer-service/repository';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const body = await req.json();
    const result = await updateCustomerServiceDraft({
      businessId: user.businessId,
      draftId: Number(params.id),
      expectedVersion: Number(body.version),
      body: String(body.body || ''),
      userId: user.userId,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 409 });
  }
}