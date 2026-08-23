import { NextResponse } from 'next/server';

import { OnlineShopDomainRepository } from '@/lib/onlineShop/onlineShopDomain';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';

function duplicate(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

export async function GET() {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  const domain = await OnlineShopDomainRepository.get(auth.user.businessId);
  return NextResponse.json({ success: true, domain,
    records: domain ? OnlineShopDomainRepository.verificationRecords(domain) : null });
}

export async function PUT(request: Request) {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid domain request is required.' }, { status: 400 }); }
  try {
    const domain = await OnlineShopDomainRepository.save(auth.user.businessId, body?.domainName);
    return NextResponse.json({ success: true, domain, records: OnlineShopDomainRepository.verificationRecords(domain) });
  } catch (error) {
    if (duplicate(error)) return NextResponse.json({ error: 'That custom domain is already connected to another store.' }, { status: 409 });
    if (error instanceof Error && /valid custom domain/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_domain', operation: 'save',
      title: 'Online shop custom domain could not be saved', error }).catch(() => {});
    return NextResponse.json({ error: 'Custom domain could not be saved.' }, { status: 500 });
  }
}

export async function POST() {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  try {
    const domain = await OnlineShopDomainRepository.verify(auth.user.businessId);
    return NextResponse.json({ success: true, domain, records: OnlineShopDomainRepository.verificationRecords(domain) });
  } catch (error) {
    if (error instanceof Error && /save a custom domain/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_domain', operation: 'verify',
      title: 'Online shop custom domain verification failed', error }).catch(() => {});
    return NextResponse.json({ error: 'Custom domain could not be verified.' }, { status: 500 });
  }
}

export async function DELETE() {
  const auth = requireAdminTier(); if (auth.response) return auth.response;
  await OnlineShopDomainRepository.remove(auth.user.businessId);
  return NextResponse.json({ success: true });
}