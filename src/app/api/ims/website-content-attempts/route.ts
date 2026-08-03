import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

type UrlDecision = { url: string; keep: boolean; reason: string };

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let productId = '';
  try {
    const body = await request.json();
    productId = String(body.productId ?? '').trim();
    const candidateUrls = (Array.isArray(body.candidateUrls) ? body.candidateUrls : [])
      .filter((url: unknown): url is string => typeof url === 'string' && url.startsWith('http'))
      .slice(0, 10)
      .map((url: string) => url.slice(0, 2048));
    const decisions: UrlDecision[] = (Array.isArray(body.decisions) ? body.decisions : [])
      .filter((decision: any) => decision?.url && candidateUrls.includes(String(decision.url)))
      .slice(0, 10)
      .map((decision: any) => ({
        url: String(decision.url).slice(0, 2048),
        keep: decision.keep === true,
        reason: String(decision.reason ?? '').slice(0, 1000),
      }));

    if (!productId || candidateUrls.length === 0 || decisions.length !== candidateUrls.length || decisions.some(decision => decision.keep)) {
      return NextResponse.json({ error: 'A product and an all-rejected URL assessment are required.' }, { status: 400 });
    }

    const products = await imsQuery<{ product_id: string }>(
      'SELECT product_id FROM ims_products WHERE product_id = ? AND business_id = ? LIMIT 1',
      [productId, session.businessId],
    );
    if (!products[0]) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });

    await imsExecute(
      `INSERT INTO ims_website_content_attempts
         (business_id, product_id, outcome, workflow, candidate_urls_json, decisions_json)
       VALUES (?, ?, 'no_valid_url', 'pending_online_bulk', ?, ?)`,
      [session.businessId, productId, JSON.stringify(candidateUrls), JSON.stringify(decisions)],
    );

    return NextResponse.json({ success: true, attemptedAt: new Date().toISOString() });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'pending-online',
      operation: 'record_website_content_attempt',
      severity: 'error',
      title: 'Website content attempt could not be recorded',
      error,
      reference: productId ? { type: 'ims_product', id: productId } : undefined,
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to record attempt.' }, { status: 500 });
  }
}