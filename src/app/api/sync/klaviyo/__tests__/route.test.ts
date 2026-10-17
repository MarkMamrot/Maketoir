import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequireAdminSession, mockTestConnection, mockAvailability, mockCreateClient } = vi.hoisted(() => ({
  mockRequireAdminSession: vi.fn(),
  mockTestConnection: vi.fn(),
  mockAvailability: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockRequireAdminSession,
}));

vi.mock('@/services/KlaviyoService', () => ({
  KlaviyoService: class {
    revision = '2024-10-15';
    testConnection = mockTestConnection;
  },
}));
vi.mock('@/lib/ims/integrationAvailability', () => ({
  assertOptionalIntegrationEnabled: mockAvailability,
  isIntegrationDisabledError: () => false,
}));
vi.mock('@/lib/db/ConnectionsRepository', () => ({
  ConnectionsRepository: { get: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/lib/klaviyo/oauth', () => ({ createKlaviyoClient: mockCreateClient }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: vi.fn().mockResolvedValue(null) }));

import { POST } from '../route';

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/sync/klaviyo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sync/klaviyo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminSession.mockReturnValue({ user: { businessId: 'business-1' } });
    mockAvailability.mockResolvedValue(undefined);
    mockTestConnection.mockResolvedValue(1);
    mockCreateClient.mockResolvedValue({ testConnection: mockTestConnection, revision: '2024-10-15' });
  });

  it('rejects unauthenticated connection tests', async () => {
    mockRequireAdminSession.mockReturnValue({
      response: new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401 }),
    });

    const response = await POST(request({ apiKey: 'private-key' }));

    expect(response.status).toBe(401);
    expect(mockTestConnection).not.toHaveBeenCalled();
  });

  it('tests the saved OAuth connection without an API key', async () => {
    const response = await POST(request({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockCreateClient).toHaveBeenCalledWith('business-1');
    expect(mockTestConnection).toHaveBeenCalledOnce();
  });

  it('delegates authenticated tests to the Klaviyo adapter', async () => {
    const response = await POST(request({ apiKey: 'private-key' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockTestConnection).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Klaviyo connected — 1 metric found.',
      revision: '2024-10-15',
    });
  });
});