import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getContactCrmPipeline, saveContactCrmPipelineStage } from '@/lib/ims/contactCrmGrowthService';
import { crmRouteError, crmWriteGuard } from '../_crmRouteHelpers';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: await getContactCrmPipeline(session.businessId) });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'load_pipeline', 0);
  }
}

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  try {
    const body = await request.json();
    const id = await saveContactCrmPipelineStage(session.businessId, null, body);
    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'create_pipeline_stage', 0);
  }
}
