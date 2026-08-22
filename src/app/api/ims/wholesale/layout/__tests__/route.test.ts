import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdminTier: vi.fn(),
  getEditorState: vi.fn(),
  saveDraft: vi.fn(),
  resetDraft: vi.fn(),
  publish: vi.fn(),
  getProfile: vi.fn(),
  reportRuntimeIssue: vi.fn().mockResolvedValue(undefined),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({ requireAdminTier: mocks.requireAdminTier }));
vi.mock('@/lib/wholesale/wholesalePortalLayout', () => ({
  WholesalePortalLayoutRepository: {
    getEditorState: mocks.getEditorState,
    saveDraft: mocks.saveDraft,
    resetDraft: mocks.resetDraft,
    publish: mocks.publish,
  },
  WholesaleLayoutRevisionConflictError: class WholesaleLayoutRevisionConflictError extends Error {
    constructor(public currentRevision: number) { super('The wholesale layout draft was changed by another editor.'); }
  },
}));
vi.mock('@/lib/wholesale/wholesaleSupplierProfile', () => ({
  WholesaleSupplierProfileRepository: { getByBusinessId: mocks.getProfile },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { GET, PUT } from '../route';
import { createDefaultWholesaleLayout } from '@/lib/wholesale/layout/validation';
import { WholesaleLayoutRevisionConflictError } from '@/lib/wholesale/wholesalePortalLayout';

const user = { businessId: 'biz-1', userId: 7, name: 'Admin User', tier: 'Admin' };
const state = {
  draft: createDefaultWholesaleLayout(), published: createDefaultWholesaleLayout(),
  draftRevision: 2, publishedRevision: 1,
};

describe('IMS wholesale layout route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminTier.mockReturnValue({ user });
  });

  it('loads the tenant editor state', async () => {
    mocks.getEditorState.mockResolvedValue(state);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.getEditorState).toHaveBeenCalledWith('biz-1');
  });

  it('saves a normalized draft against the expected revision', async () => {
    mocks.saveDraft.mockResolvedValue({ ...state, draftRevision: 3 });
    const response = await PUT(new Request('http://localhost/api/ims/wholesale/layout', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_draft', expectedRevision: 2, document: state.draft }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.saveDraft).toHaveBeenCalledWith('biz-1', state.draft, 2, { userId: 7, name: 'Admin User' });
  });

  it('returns a structured conflict without reporting an operational issue', async () => {
    mocks.saveDraft.mockRejectedValue(new WholesaleLayoutRevisionConflictError(4));
    const response = await PUT(new Request('http://localhost/api/ims/wholesale/layout', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_draft', expectedRevision: 2, document: state.draft }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'wholesale_layout_revision_conflict', currentRevision: 4 });
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('publishes only the saved revision and revalidates the supplier routes', async () => {
    mocks.publish.mockResolvedValue({ ...state, publishedRevision: 2 });
    mocks.getProfile.mockResolvedValue({ slug: 'supplier-one' });
    const response = await PUT(new Request('http://localhost/api/ims/wholesale/layout', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish', expectedRevision: 2 }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith('biz-1', 2, { userId: 7, name: 'Admin User' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/wholesale/supplier-one');
  });
});