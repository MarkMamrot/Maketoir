import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSession, mockTier, mockList, mockCreate, mockGet } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockTier: vi.fn(), mockList: vi.fn(), mockCreate: vi.fn(), mockGet: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mockSession, requireAdminTier: mockTier }));
vi.mock('@/lib/foresight/repositories/ForesightPlanningRepository', () => ({
  ForesightPlanningRepository: { listThreads: mockList, createThread: mockCreate, getThread: mockGet },
}));

import { GET, POST } from '../route';

describe('/api/foresight/planning/threads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockTier.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue(12);
    mockGet.mockResolvedValue({ id: 12, business_id: 'business-1', revision: 1 });
  });

  it('lists only the session tenant threads', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith('business-1', 50);
  });

  it('creates a validated thread for the session tenant and actor', async () => {
    const request = new Request('http://localhost/api/foresight/planning/threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadType: 'initiative', title: 'Spring campaign', businessId: 'other' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith('business-1', {
      threadType: 'initiative', title: 'Spring campaign', createdBy: 7,
    });
  });

  it('rejects invalid thread types before persistence', async () => {
    const request = new Request('http://localhost/api/foresight/planning/threads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadType: 'execute_campaign', title: 'Unsafe' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});