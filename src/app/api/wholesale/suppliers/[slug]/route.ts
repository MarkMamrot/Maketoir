import { NextResponse } from 'next/server';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';

export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  try {
    const profile = await WholesaleSupplierProfileRepository.getActiveBySlug(params.slug);
    if (!profile) {
      return NextResponse.json({ error: 'Wholesale supplier not found.' }, { status: 404 });
    }

    return NextResponse.json({
      supplier: {
        slug: profile.slug,
        displayName: profile.displayName,
        logoUrl: profile.logoUrl,
        supportEmail: profile.supportEmail,
      },
    });
  } catch (error) {
    await reportRuntimeIssue({
      source: 'wholesale.supplier_profile',
      operation: 'load_public_profile',
      title: 'Wholesale supplier profile could not be loaded',
      error,
      context: { slugLength: params.slug?.length ?? 0 },
    });
    return NextResponse.json({ error: 'Wholesale supplier could not be loaded.' }, { status: 500 });
  }
}