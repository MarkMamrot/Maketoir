import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { saveContactCrmPipelineStage } from '@/lib/ims/contactCrmGrowthService';
import { crmRouteError, crmWriteGuard } from '../../../_crmRouteHelpers';

export async function PATCH(request: Request, { params }: { params: { stageId: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const denied = crmWriteGuard(session);
  if (denied) return denied;
  try {
    await saveContactCrmPipelineStage(session.businessId, Number(params.stageId), await request.json());
    return NextResponse.json({ success: true });
  } catch (error) {
    return crmRouteError(error, session.businessId, 'update_pipeline_stage', 0);
  }
}
