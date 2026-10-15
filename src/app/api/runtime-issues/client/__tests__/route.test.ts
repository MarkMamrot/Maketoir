import { beforeEach, describe, expect, it, vi } from 'vitest';
const { report, session } = vi.hoisted(() => ({ report: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: report }));
vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: session }));
import { POST } from '../route';
beforeEach(() => { vi.clearAllMocks(); session.mockResolvedValue({ businessId: 'test-business' }); });
describe('terminal runtime issues', () => {
  it.each(['pos_terminal_readiness', 'pos_terminal_delay', 'pos_audio_playback'])('records %s under the authenticated POS business', async operation => {
    const response = await POST(new Request('https://solvantis.com.au/api/runtime-issues/client', {
      method: 'POST', body: JSON.stringify({ operation, message: 'Device diagnostic', businessId: 'test-business',
        metrics: { readinessWaitMs: 2_000, readinessCached: false, firstTerminalEventMs: null, secret: 'must not persist' } }),
    }));
    expect(response.status).toBe(200);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'test-business', operation,
      context: expect.objectContaining({ terminal_timing: { readinessWaitMs: 2_000, readinessCached: false, firstTerminalEventMs: null } }),
    }));
    expect(JSON.stringify(report.mock.calls)).not.toContain('must not persist');
  });
  it('rejects invalid diagnostics rather than persisting untrusted values', async () => {
    const response = await POST(new Request('https://solvantis.com.au/api/runtime-issues/client', {
      method: 'POST', body: JSON.stringify({ operation: 'pos_terminal_delay', message: 'Slow', metrics: { readinessWaitMs: -5 } }),
    }));
    expect(response.status).toBe(400);
    expect(report).not.toHaveBeenCalled();
  });
  it.each(['pos_sale_local_storage', 'pos_sale_sync', 'pos_catalogue_refresh'])('records %s with the original sale reference', async operation => {
    const response = await POST(new Request('https://solvantis.com.au/api/runtime-issues/client', {
      method: 'POST', body: JSON.stringify({ operation, message: 'Device recovery required', businessId: 'test-business', localId: 'paid-sale' }),
    }));
    expect(response.status).toBe(200);
    expect(session).toHaveBeenCalledWith(['pos_session', 'marketoir_session']);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'test-business', operation, reference: { type: 'pos_sale_local_id', id: 'paid-sale' },
    }));
  });
  it('does not attach a previous business sale to the newly authenticated business', async () => {
    const response = await POST(new Request('https://solvantis.com.au/api/runtime-issues/client', {
      method: 'POST', body: JSON.stringify({ operation: 'pos_sale_sync', message: 'Review required', businessId: 'previous-business', localId: 'paid-sale' }),
    }));
    expect(response.status).toBe(409);
    expect(report).not.toHaveBeenCalled();
  });
  it('ignores a non-string optional sale reference instead of throwing', async () => {
    const response = await POST(new Request('https://solvantis.com.au/api/runtime-issues/client', {
      method: 'POST', body: JSON.stringify({ operation: 'pos_sale_sync', message: 'Review required', localId: 123 }),
    }));
    expect(response.status).toBe(200);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ reference: undefined }));
  });
  it.each(['pos_terminal_refund', 'pos_terminal_purchase'])('persists %s with authenticated tenant context', async operation => {
    const response = await POST(new Request('http://localhost/api/runtime-issues/client', { method: 'POST', body: JSON.stringify({ operation, message: 'Terminal failed', pathname: '/pos' }) }));
    expect(response.status).toBe(200);
    expect(session).toHaveBeenCalledWith(['pos_session', 'marketoir_session']);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'test-business', source: 'pos_terminal', operation }));
  });
  it('rejects unauthenticated reports', async () => {
    session.mockResolvedValue(null);
    const response = await POST(new Request('http://localhost/api/runtime-issues/client', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(401);
    expect(report).not.toHaveBeenCalled();
  });
});