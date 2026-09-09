import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { getShippingManifestSummaryPdf } from '@/lib/ims/shipping/shippingManifests';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const manifestId = Number(params.id);
  if (!Number.isInteger(manifestId) || manifestId <= 0) return NextResponse.json({ error: 'A valid manifest ID is required.' }, { status: 400 });
  try {
    const result = await getShippingManifestSummaryPdf(session.businessId, manifestId);
    return new NextResponse(result.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${result.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to download the manifest.';
    const validation = /not found|not ready|unavailable|required/i.test(message);
    if (!validation) {
      await reportRuntimeIssue({
        businessId: session.businessId, source: 'ims_shipping', operation: 'download_manifest',
        title: 'Carrier manifest PDF could not be downloaded', error,
        context: { manifestId }, reference: { type: 'shipping_manifest', id: String(manifestId) },
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: validation ? 400 : 502 });
  }
}
