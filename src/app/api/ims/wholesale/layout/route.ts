import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireAdminTier } from '@/lib/sessionUtils';
import { normalizeWholesaleLayoutDocument } from '@/lib/wholesale/layout/validation';
import {
  WholesaleLayoutRevisionConflictError,
  WholesalePortalLayoutRepository,
} from '@/lib/wholesale/wholesalePortalLayout';
import { WholesaleSupplierProfileRepository } from '@/lib/wholesale/wholesaleSupplierProfile';

export async function GET() {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;
  try {
    const state = await WholesalePortalLayoutRepository.getEditorState(auth.user.businessId);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'wholesale_layout_editor',
      operation: 'load_layout',
      title: 'Wholesale layout could not be loaded',
      error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The wholesale layout could not be loaded.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = requireAdminTier();
  if (auth.response) return auth.response;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 });
  }
  const action = String(body?.action ?? '');
  const expectedRevision = Number(body?.expectedRevision);
  if (!['save_draft', 'reset_draft', 'publish'].includes(action)) {
    return NextResponse.json({ error: 'A valid layout action is required.' }, { status: 400 });
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return NextResponse.json({ error: 'A valid draft revision is required.' }, { status: 400 });
  }

  const actor = { userId: auth.user.userId, name: auth.user.name };
  try {
    const state = action === 'save_draft'
      ? await WholesalePortalLayoutRepository.saveDraft(
          auth.user.businessId,
          normalizeWholesaleLayoutDocument(body.document),
          expectedRevision,
          actor,
        )
      : action === 'reset_draft'
        ? await WholesalePortalLayoutRepository.resetDraft(auth.user.businessId, expectedRevision, actor)
        : await WholesalePortalLayoutRepository.publish(auth.user.businessId, expectedRevision, actor);

    if (action === 'publish') {
      const profile = await WholesaleSupplierProfileRepository.getByBusinessId(auth.user.businessId);
      if (profile) {
        revalidatePath(`/wholesale/${profile.slug}`);
        revalidatePath(`/wholesale/${profile.slug}/[section]`, 'page');
      }
    }
    return NextResponse.json({ success: true, state });
  } catch (error) {
    if (error instanceof WholesaleLayoutRevisionConflictError) {
      return NextResponse.json({
        error: error.message,
        code: 'wholesale_layout_revision_conflict',
        currentRevision: error.currentRevision,
      }, { status: 409 });
    }
    if (action === 'publish' && error instanceof Error && error.message.startsWith('Save a wholesale layout draft')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId: auth.user.businessId,
      source: 'wholesale_layout_editor',
      operation: action,
      title: 'Wholesale layout operation failed',
      error,
      context: { expectedRevision },
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'The wholesale layout could not be updated.' }, { status: 500 });
  }
}