import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ execute: mocks.execute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { getAuthRequestMetadata, recordAuthEvent } from '../authActivity';

describe('authentication activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({});
    mocks.reportRuntimeIssue.mockResolvedValue(null);
  });

  it('extracts the client IP and coarse platform location', () => {
    const request = new Request('https://app.example.com/login', {
      headers: {
        'x-forwarded-for': '203.0.113.5, 10.0.0.1',
        'x-vercel-ip-city': 'Melbourne%20CBD',
        'x-vercel-ip-country-region': 'VIC',
        'x-vercel-ip-country': 'au',
        'user-agent': 'Example Browser',
      },
    });

    expect(getAuthRequestMetadata(request)).toEqual({
      ipAddress: '203.0.113.5',
      city: 'Melbourne CBD',
      region: 'VIC',
      country: 'AU',
      userAgent: 'Example Browser',
    });
  });

  it('purges expired activity and records the event', async () => {
    const request = new Request('https://app.example.com/login', {
      headers: { 'x-real-ip': '2001:db8::1' },
    });

    await recordAuthEvent({
      userId: 42,
      businessId: 'biz-1',
      eventType: 'login_success',
      request,
    });

    expect(mocks.execute.mock.calls[0][0]).toContain('INTERVAL 90 DAY');
    expect(mocks.execute.mock.calls[1][1]).toEqual([
      'biz-1', 42, 'login_success', null, '2001:db8::1', null, null, null, null,
    ]);
  });

  it('reports storage failures without rejecting the authentication action', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(recordAuthEvent({
      userId: 42,
      eventType: 'password_reset_completed',
      request: new Request('https://app.example.com/reset-password'),
    })).resolves.toBeUndefined();

    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'record_auth_event',
      context: { userId: 42, eventType: 'password_reset_completed' },
    }));
  });
});