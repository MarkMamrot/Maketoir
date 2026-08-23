import { NextResponse } from 'next/server';
import { OnlineShopAssetRepository } from '@/lib/onlineShop/onlineShopAsset';
import { OnlineSalesChannelRepository, OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';

function duplicate(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY'); }

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  try {
    const [profile, activeChannel] = await Promise.all([
      OnlineShopProfileRepository.getByBusinessId(auth.user.businessId),
      OnlineSalesChannelRepository.get(auth.user.businessId),
    ]);
    return NextResponse.json({ success: true, profile, activeChannel });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_profile', operation: 'load', title: 'Online shop profile could not be loaded', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Online shop settings could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 }); }
  const logoUrl = typeof body?.logoUrl === 'string' ? body.logoUrl.trim() : '';
  if (logoUrl) {
    const match = /^\/api\/shop\/assets\/([0-9a-f-]{36})$/.exec(logoUrl);
    if (!match) return NextResponse.json({ error: 'Choose a logo from this organisation’s online shop images.' }, { status: 400 });
    const owned = await OnlineShopAssetRepository.findOwnedActiveIds(auth.user.businessId, [match[1]]);
    if (!owned.has(match[1])) return NextResponse.json({ error: 'The selected logo is unavailable for this organisation.' }, { status: 400 });
  }
  try {
    const existing = await OnlineShopProfileRepository.getByBusinessId(auth.user.businessId);
    await OnlineShopProfileRepository.upsert({ businessId: auth.user.businessId, slug: body?.slug,
      displayName: String(body?.displayName ?? ''), logoUrl: logoUrl || null, supportEmail: body?.supportEmail,
      defaultMetaTitle: body?.defaultMetaTitle, defaultMetaDescription: body?.defaultMetaDescription,
      isActive: existing?.isActive === true });
    return NextResponse.json({ success: true, profile: await OnlineShopProfileRepository.getByBusinessId(auth.user.businessId) });
  } catch (error) {
    if (duplicate(error)) return NextResponse.json({ error: 'That online shop address is already in use.' }, { status: 409 });
    if (error instanceof Error && /required|slug|reserved|email/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_profile', operation: 'save', title: 'Online shop profile update failed', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Online shop settings could not be saved.' }, { status: 500 });
  }
}