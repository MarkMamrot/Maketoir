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

  it('records the event before purging activity strictly older than 12 calendar months', async () => {
    const request = new Request('https://app.example.com/login', {
      headers: { 'x-real-ip': '2001:db8::1' },
    });

    await recordAuthEvent({
      userId: 42,
      businessId: 'biz-1',
      eventType: 'login_success',
      request,
    });

    expect(mocks.execute.mock.calls[1][0]).toContain('created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 12 MONTH)');
    expect(mocks.execute.mock.calls[0][1]).toEqual([
      'biz-1', 42, 'login_success', null, '2001:db8::1', null, null, null, null,
    ]);
  });

  it('retains an unidentified failed attempt and reports maintenance failure separately', async () => {
    mocks.execute.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('purge unavailable'));
    await recordAuthEvent({ eventType: 'login_failure', request: new Request('https://app.example.com/login') });
    expect(mocks.execute.mock.calls[0][1].slice(0, 4)).toEqual([null, null, 'login_failure', null]);
    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({ operation: 'purge_expired_auth_events' }));
  });

  it('does not hide failure of the runtime issue recorder', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('storage unavailable'));
    mocks.reportRuntimeIssue.mockRejectedValueOnce(new Error('issue recorder unavailable'));
    await expect(recordAuthEvent({ eventType: 'login_failure', request: new Request('https://app.example.com/login') }))
      .rejects.toThrow('issue recorder unavailable');
  });

  it('strips encoded controls from coarse location headers', () => {
    expect(getAuthRequestMetadata(new Request('https://app.example.com', {
      headers: { 'x-vercel-ip-city': 'City%00Name' },
    })).city).toBe('CityName');
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