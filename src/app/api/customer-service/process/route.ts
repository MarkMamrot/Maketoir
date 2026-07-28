import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import { processCustomerServiceInbox } from '@/lib/customer-service/aiPipeline';
import { curateCustomerServiceLearnings } from '@/lib/customer-service/learningCurator';

export async function POST() {
  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const result = await processCustomerServiceInbox(user.businessId);
    let learning: { processed: number; candidates: number; activated: number } | null = null;
    try {
      learning = await curateCustomerServiceLearnings(user.businessId);
    } catch {
      learning = null;
    }
    return NextResponse.json({ success: true, ...result, learning });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}