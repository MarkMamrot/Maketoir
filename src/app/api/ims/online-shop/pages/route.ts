import { NextResponse } from 'next/server';
import { OnlineShopPageRepository } from '@/lib/onlineShop/onlineShopPages';
import { nativeShopDisabledResponse } from '@/lib/onlineShop/onlineShopCapability';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';

function duplicate(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY'); }

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  try { return NextResponse.json({ success: true, pages: await OnlineShopPageRepository.list(auth.user.businessId) }); }
  catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_pages', operation: 'list', title: 'Online shop pages could not be listed', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Shop pages could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 }); }
  try {
    const page = await OnlineShopPageRepository.create(auth.user.businessId, { slug: body?.slug, title: body?.title }, { userId: auth.user.userId, name: auth.user.name });
    return NextResponse.json({ success: true, page }, { status: 201 });
  } catch (error) {
    if (duplicate(error)) return NextResponse.json({ error: 'That page slug is already in use.' }, { status: 409 });
    if (error instanceof Error && /required|slug/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_pages', operation: 'create', title: 'Online shop page creation failed', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The shop page could not be created.' }, { status: 500 });
  }
}