import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSession, mockRequireAdminTier, mockGetAvailability, mockSetAvailability, mockReportIssue } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireAdminTier: vi.fn(),
  mockGetAvailability: vi.fn(),
  mockSetAvailability: vi.fn(),
  mockReportIssue: vi.fn(),
}));

vi.mock('@/lib/sessionUtils', () => ({
  requireAdminSession: mockGetSession,
  requireAdminTier: mockRequireAdminTier,
}));
vi.mock('@/lib/ims/integrationAvailability', () => ({
  getOptionalIntegrationAvailability: mockGetAvailability,
  isIntegrationAvailabilityNotReadyError: () => false,
  isOptionalIntegrationProvider: (value: unknown) => ['cin7', 'google', 'meta', 'klaviyo', 'gmail'].includes(String(value)),
  setOptionalIntegrationAvailability: mockSetAvailability,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mockReportIssue }));

import { GET, PUT } from '../route';

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/ims/integrations', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/ims/integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockReturnValue({
      user: { businessId: 'business-1', tier: 'StandardUser' },
    });
    mockRequireAdminTier.mockReturnValue({
      user: { businessId: 'business-1', tier: 'Admin' },
    });
    mockGetAvailability.mockResolvedValue({
      cin7: { enabled: true, configured: true, status: 'configured' },
      google: { enabled: false, configured: true, status: 'configured' },
      meta: { enabled: false, configured: false, status: 'not_configured' },
      klaviyo: { enabled: true, configured: true, status: 'configured' },
      gmail: { enabled: false, configured: false, status: 'not_configured' },
    });
    mockSetAvailability.mockResolvedValue({
      enabled: true,
      configured: false,
      status: 'not_configured',
    });
    mockReportIssue.mockResolvedValue(null);
  });

  it('returns only secret-free enabled/configured metadata and a management capability', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      businessId: 'business-1',
      integrations: {
        cin7: { enabled: true, configured: true },
        google: { enabled: false, configured: true },
        meta: { enabled: false, configured: false },
        klaviyo: { enabled: true, configured: true },
        gmail: { enabled: false, configured: false },
      },
      canManage: false,
    });
  });

  it('allows Admin and SuperAdmin to update only supported provider booleans', async () => {
    const response = await PUT(putRequest({ provider: 'gmail', enabled: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      businessId: 'business-1',
      provider: 'gmail',
      enabled: true,
      configured: false,
    });
    expect(mockSetAvailability).toHaveBeenCalledWith('business-1', 'gmail', true);
  });

  it('accepts an expected business matching the resolved session tenant', async () => {
    const response = await PUT(putRequest({ provider: 'gmail', enabled: true, expectedBusinessId: 'business-1' }));

    expect(response.status).toBe(200);
    expect((await response.json()).businessId).toBe('business-1');
    expect(mockSetAvailability).toHaveBeenCalledWith('business-1', 'gmail', true);
  });

  it.each(['old-business', '', null, 123])('rejects stale or invalid expected business %s before IMS work', async expectedBusinessId => {
    const response = await PUT(putRequest({ provider: 'gmail', enabled: true, expectedBusinessId }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false, businessId: 'business-1', code: 'business_context_changed',
    });
    expect(mockSetAvailability).not.toHaveBeenCalled();
    expect(mockGetAvailability).not.toHaveBeenCalled();
    expect(mockReportIssue).not.toHaveBeenCalled();
  });

  it('rejects malformed or unsupported provider state without writing', async () => {
    const response = await PUT(putRequest({ provider: 'shopify', enabled: false }));

    expect(response.status).toBe(400);
    expect(mockSetAvailability).not.toHaveBeenCalled();
  });
});
