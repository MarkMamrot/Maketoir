import { NextResponse } from 'next/server';

import { ProductBuildConflictError } from '@/lib/ims/builds/buildService';
import { ProductBuildValidationError } from '@/lib/ims/builds/domain';
import { ProductBuildRecipeConflictError } from '@/lib/ims/builds/recipeService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export function advisorReadOnly() {
  return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
}

export async function buildRouteError(
  error: unknown,
  input: { businessId: string; operation: string; context?: Record<string, unknown>; reference?: { type: string; id: string | number } },
) {
  if (error instanceof ProductBuildValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ProductBuildConflictError || error instanceof ProductBuildRecipeConflictError || error instanceof RangeError) {
    return NextResponse.json({
      error: error.message,
      ...('code' in error ? { code: error.code } : {}),
      ...(error instanceof ProductBuildConflictError && error.details ? error.details : {}),
    }, { status: 409 });
  }
  if (!(error && typeof error === 'object' && 'runtimeIssueReported' in error)) {
    await reportRuntimeIssue({
      businessId: input.businessId,
      source: 'ims_product_builds_api',
      operation: input.operation,
      title: 'Product builds API request failed',
      error,
      context: input.context,
      reference: input.reference,
    }).catch(() => {});
  }
  return NextResponse.json({ error: 'The product build request could not be completed.' }, { status: 500 });
}