import { NextRequest, NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { listProductBuildRecipes, saveProductBuildRecipe } from '@/lib/ims/builds/recipeService';
import { advisorReadOnly, buildRouteError } from '../../../builds/_routeSupport';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const data = await listProductBuildRecipes(session.businessId, { productId: params.id });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return buildRouteError(error, {
      businessId: session.businessId,
      operation: 'recipe_list',
      reference: { type: 'ims_product', id: params.id },
    });
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return advisorReadOnly();
  try {
    const body = await request.json().catch(() => ({}));
    const data = await saveProductBuildRecipe({
      businessId: session.businessId,
      productId: params.id,
      outputVariantId: body.outputVariantId,
      components: body.components,
      baseOutputQuantity: body.baseOutputQuantity,
      overheadPerOutput: body.overheadPerOutput,
      notes: body.notes,
      isEnabled: body.isEnabled,
      expectedRevision: body.expectedRevision,
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return buildRouteError(error, {
      businessId: session.businessId,
      operation: 'recipe_save',
      reference: { type: 'ims_product', id: params.id },
    });
  }
}