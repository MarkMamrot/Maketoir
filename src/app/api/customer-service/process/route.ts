import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { processCustomerServiceInbox } from '@/lib/customer-service/aiPipeline';

export async function POST() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const result = await processCustomerServiceInbox(user.businessId);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}