import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetImsSession, mockRenameForBusiness, mockReportRuntimeIssue } = vi.hoisted(() => ({
  mockGetImsSession: vi.fn(),
  mockRenameForBusiness: vi.fn(),
  mockReportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mockGetImsSession }));
vi.mock('@/lib/channels/channelInstanceRepository', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/channels/channelInstanceRepository')>();
  return {
    ...original,
    SalesChannelInstanceRepository: { renameForBusiness: mockRenameForBusiness },
  };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportRuntimeIssue }));

import { PATCH } from '../route';

const context = { params: { id: 'instance-1' } };
const request = (body: unknown) => new Request('http://localhost/api/ims/channels/instance-1', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('PATCH /api/ims/channels/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', tier: 'Admin' });
    mockReportRuntimeIssue.mockResolvedValue(undefined);
    mockRenameForBusiness.mockResolvedValue({ channelInstanceId: 'instance-1', displayName: 'Retail Store' });
  });

  it('requires authentication', async () => {
    mockGetImsSession.mockResolvedValue(null);
    expect((await PATCH(request({ displayName: 'Retail Store' }), context)).status).toBe(401);
    expect(mockRenameForBusiness).not.toHaveBeenCalled();
  });

  it.each(['Advisor', 'StandardUser'])('requires administrator access for %s', async tier => {
    mockGetImsSession.mockResolvedValue({ businessId: 'business-1', tier });
    expect((await PATCH(request({ displayName: 'Retail Store' }), context)).status).toBe(403);
    expect(mockRenameForBusiness).not.toHaveBeenCalled();
  });

  it('updates only the signed-in business instance', async () => {
    const response = await PATCH(request({ displayName: 'Retail Store' }), context);
    expect(response.status).toBe(200);
    expect(mockRenameForBusiness).toHaveBeenCalledWith({
      businessId: 'business-1', channelInstanceId: 'instance-1', displayName: 'Retail Store',
    });
  });

  it('rejects invalid field types', async () => {
    const response = await PATCH(request({ displayName: 42 }), context);
    expect(response.status).toBe(400);
    expect(mockRenameForBusiness).not.toHaveBeenCalled();
  });

  it('rejects lifecycle fields until runtime consumers honor instance state', async () => {
    const response = await PATCH(request({ displayName: 'Retail Store', enabled: false }), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Only the channel display name can be changed here.' });
    expect(mockRenameForBusiness).not.toHaveBeenCalled();
  });

  it('returns 404 without revealing another business instance', async () => {
    mockRenameForBusiness.mockResolvedValue(null);
    const response = await PATCH(request({ displayName: 'Retail Store' }), context);
    expect(response.status).toBe(404);
  });

  it('reports operational failures without exposing details', async () => {
    mockRenameForBusiness.mockRejectedValue(new Error('database unavailable'));
    const response = await PATCH(request({ displayName: 'Retail Store' }), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Sales channel could not be renamed.' });
    expect(mockReportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', operation: 'rename', reference: { type: 'sales_channel_instance', id: 'instance-1' },
    }));
  });
});