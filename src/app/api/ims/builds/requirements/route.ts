import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { listBuildRequirements } from '@/lib/ims/builds/buildRequirementService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  try {
    const data = await listBuildRequirements(session.businessId, {
      state: searchParams.get('state') || undefined,
      locationId: Number(searchParams.get('locationId')) || undefined,
      limit: Number(searchParams.get('limit')) || undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims_product_build_requirements',
      operation: 'list',
      title: 'Build requirements could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}