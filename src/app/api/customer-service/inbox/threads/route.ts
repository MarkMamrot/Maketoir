import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { listCustomerServiceThreads } from '@/lib/customer-service/repository';

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  const params = new URL(req.url).searchParams;
  try {
    const result = await listCustomerServiceThreads(user.businessId, {
      page: Number(params.get('page') || 1),
      pageSize: Number(params.get('pageSize') || 30),
      query: params.get('q') || '',
      category: params.get('category') || '',
      status: params.get('status') || '',
      unread: params.get('unread') === 'true',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}