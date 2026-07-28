import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { getCustomerServiceThread, updateCustomerServiceThread } from '@/lib/customer-service/repository';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const threadId = Number(params.id);
  if (!Number.isInteger(threadId)) return NextResponse.json({ error: 'Invalid thread ID' }, { status: 400 });
  const data = await getCustomerServiceThread(user.businessId, threadId);
  return data ? NextResponse.json({ success: true, ...data }) : NextResponse.json({ error: 'Thread not found' }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const threadId = Number(params.id);
  if (!Number.isInteger(threadId)) return NextResponse.json({ error: 'Invalid thread ID' }, { status: 400 });
  const body = await req.json();
  const updated = await updateCustomerServiceThread(user.businessId, threadId, { ...body, userId: user.userId });
  return updated ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'No valid changes' }, { status: 400 });
}