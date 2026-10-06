import { beforeEach, describe, expect, it, vi } from 'vitest';

const runMaintenance = vi.hoisted(() => vi.fn());
vi.mock('@/lib/salesAssistant/retention', () => ({ runProspectConversationMaintenance: runMaintenance }));

import { POST } from '../route';

function request(secret?: string) {
  return new Request('http://localhost/api/cron/prospect-conversations', {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('prospect conversation maintenance cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret';
    runMaintenance.mockResolvedValue({ abandoned: 0 });
  });

  it('accepts the redirect-safe cron header', async () => {
    const response = await POST(request('cron-secret'));
    expect(response.status).toBe(200);
    expect(runMaintenance).toHaveBeenCalledOnce();
  });

  it('rejects an invalid cron header', async () => {
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(runMaintenance).not.toHaveBeenCalled();
  });

  it('returns a safe error when maintenance fails', async () => {
    runMaintenance.mockRejectedValue(new Error('database unavailable'));
    const response = await POST(request('cron-secret'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Prospect conversation maintenance failed.' });
  });
});