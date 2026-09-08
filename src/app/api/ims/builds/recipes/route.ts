import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { listProductBuildRecipes } from '@/lib/ims/builds/recipeService';
import { buildRouteError } from '../_routeSupport';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await listProductBuildRecipes(session.businessId, { enabledOnly: true });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return buildRouteError(error, { businessId: session.businessId, operation: 'recipe_catalogue' });
  }
}