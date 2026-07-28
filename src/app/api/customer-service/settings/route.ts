import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/sessionUtils';
import {
  getCustomerServiceSettings,
  saveCustomerServiceSettings,
} from '@/lib/customer-service/repository';

export async function GET() {
  const { user, response } = requireAdminSession();
  if (response) return response;

  try {
    return NextResponse.json({ success: true, settings: await getCustomerServiceSettings(user.businessId) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;

  try {
    const input = await req.json();
    await saveCustomerServiceSettings(user.businessId, input);
    return NextResponse.json({ success: true, settings: await getCustomerServiceSettings(user.businessId) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}