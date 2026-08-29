import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { OnlineShopAssetRepository } from '@/lib/onlineShop/onlineShopAsset';
import { normalizeOnlineShopLayoutDocument } from '@/lib/onlineShop/layout/validation';
import { OnlineShopLayoutRepository, OnlineShopLayoutRevisionConflictError } from '@/lib/onlineShop/onlineShopLayout';
import { nativeShopDisabledResponse } from '@/lib/onlineShop/onlineShopCapability';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  try {
    return NextResponse.json({ success: true, state: await OnlineShopLayoutRepository.getEditorState(auth.user.businessId) });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_layout_editor', operation: 'load_layout', title: 'Online shop layout could not be loaded', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The online shop layout could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  const disabled = await nativeShopDisabledResponse(auth.user.businessId); if (disabled) return disabled;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 }); }
  const action = String(body?.action ?? '');
  const expectedRevision = Number(body?.expectedRevision);
  if (!['save_draft', 'reset_draft', 'publish'].includes(action)) return NextResponse.json({ error: 'A valid layout action is required.' }, { status: 400 });
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return NextResponse.json({ error: 'A valid draft revision is required.' }, { status: 400 });
  const actor = { userId: auth.user.userId, name: auth.user.name };
  try {
    const document = action === 'save_draft' ? normalizeOnlineShopLayoutDocument(body.document) : null;
    if (document) {
      const assetIds = [...new Set(Object.values(document.pages).flatMap(page => page.sections
        .map(section => section.settings.assetId).filter((id): id is string => Boolean(id))))];
      const owned = await OnlineShopAssetRepository.findOwnedActiveIds(auth.user.businessId, assetIds);
      if (owned.size !== assetIds.length) return NextResponse.json({ error: 'One or more selected shop images are unavailable for this organisation.' }, { status: 400 });
    }
    const state = action === 'save_draft'
      ? await OnlineShopLayoutRepository.saveDraft(auth.user.businessId, document!, expectedRevision, actor)
      : action === 'reset_draft'
        ? await OnlineShopLayoutRepository.resetDraft(auth.user.businessId, expectedRevision, actor)
        : await OnlineShopLayoutRepository.publish(auth.user.businessId, expectedRevision, actor);
    if (action === 'publish') {
      const profile = await OnlineShopProfileRepository.getByBusinessId(auth.user.businessId);
      if (profile) revalidatePath(`/shop/${profile.slug}`, 'layout');
    }
    return NextResponse.json({ success: true, state });
  } catch (error) {
    if (error instanceof OnlineShopLayoutRevisionConflictError) return NextResponse.json({ error: error.message, code: 'online_shop_layout_revision_conflict', currentRevision: error.currentRevision }, { status: 409 });
    if (action === 'publish' && error instanceof Error && error.message.startsWith('Save an online shop layout')) return NextResponse.json({ error: error.message }, { status: 409 });
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'online_shop_layout_editor', operation: action, title: 'Online shop layout operation failed', error }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The online shop layout could not be updated.' }, { status: 500 });
  }
}