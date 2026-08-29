import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { OnlineShopAssetRepository } from '@/lib/onlineShop/onlineShopAsset';
import { normalizeOnlineShopContentPage } from '@/lib/onlineShop/layout/validation';
import { OnlineShopPageRepository, OnlineShopPageRevisionConflictError } from '@/lib/onlineShop/onlineShopPages';
import { nativeShopDisabledResponse } from '@/lib/onlineShop/onlineShopCapability';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';

function validPageId(value: string): boolean { return /^[0-9a-f-]{36}$/.test(value); }
function duplicate(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY'); }

async function revalidatePage(businessId: string, slug: string) {
  const profile = await OnlineShopProfileRepository.getByBusinessId(businessId);
  if (profile) revalidatePath(`/shop/${profile.slug}/pages/${slug}`);
}

export async function GET(_: Request, { params }: { params: { pageId: string } }) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  if (!validPageId(params.pageId)) return NextResponse.json({ error: 'Page not found.' }, { status: 404 });
  try {
    const page = await OnlineShopPageRepository.getEditorState(auth.user.businessId, params.pageId);
    return page ? NextResponse.json({ success: true, page }) : NextResponse.json({ error: 'Page not found.' }, { status: 404 });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_pages', operation: 'load', title: 'Online shop page could not be loaded', error,
      reference: { type: 'online_shop_page', id: params.pageId } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The shop page could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { pageId: string } }) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  if (!validPageId(params.pageId)) return NextResponse.json({ error: 'Page not found.' }, { status: 404 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 }); }
  const action = String(body?.action ?? ''); const expectedRevision = Number(body?.expectedRevision);
  if (!['save_draft', 'reset_draft', 'publish'].includes(action)) return NextResponse.json({ error: 'A valid page action is required.' }, { status: 400 });
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return NextResponse.json({ error: 'A valid draft revision is required.' }, { status: 400 });
  const actor = { userId: auth.user.userId, name: auth.user.name };
  try {
    const document = action === 'save_draft' ? normalizeOnlineShopContentPage(body.document) : null;
    if (document) {
      const assetIds = [...new Set(document.sections.map(section => section.settings.assetId).filter((id): id is string => Boolean(id)))];
      const owned = await OnlineShopAssetRepository.findOwnedActiveIds(auth.user.businessId, assetIds);
      if (owned.size !== assetIds.length) return NextResponse.json({ error: 'One or more selected shop images are unavailable for this organisation.' }, { status: 400 });
    }
    const page = action === 'save_draft'
      ? await OnlineShopPageRepository.saveDraft(auth.user.businessId, params.pageId, { ...body, document, expectedRevision }, actor)
      : action === 'reset_draft'
        ? await OnlineShopPageRepository.resetDraft(auth.user.businessId, params.pageId, expectedRevision, actor)
        : await OnlineShopPageRepository.publish(auth.user.businessId, params.pageId, expectedRevision, actor);
    if (action === 'publish') await revalidatePage(auth.user.businessId, page.slug);
    return NextResponse.json({ success: true, page });
  } catch (error) {
    if (error instanceof OnlineShopPageRevisionConflictError) return NextResponse.json({ error: error.message, code: 'online_shop_page_revision_conflict', currentRevision: error.currentRevision }, { status: 409 });
    if (duplicate(error)) return NextResponse.json({ error: 'That page slug is already in use.' }, { status: 409 });
    if (error instanceof Error && /not found|required|slug|title/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 400 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_pages', operation: action, title: 'Online shop page operation failed', error,
      reference: { type: 'online_shop_page', id: params.pageId } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The shop page could not be updated.' }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { pageId: string } }) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  if (!validPageId(params.pageId)) return NextResponse.json({ error: 'Page not found.' }, { status: 404 });
  try {
    const page = await OnlineShopPageRepository.getEditorState(auth.user.businessId, params.pageId);
    if (!page || !await OnlineShopPageRepository.delete(auth.user.businessId, params.pageId)) return NextResponse.json({ error: 'Page not found.' }, { status: 404 });
    await revalidatePage(auth.user.businessId, page.slug);
    return NextResponse.json({ success: true });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_pages', operation: 'delete', title: 'Online shop page deletion failed', error,
      reference: { type: 'online_shop_page', id: params.pageId } }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The shop page could not be deleted.' }, { status: 500 });
  }
}