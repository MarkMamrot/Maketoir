import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/sessionUtils', () => ({ requireAdminSession: mocks.session }));
vi.mock('@/lib/foresight/repositories/ForesightCreativeRepository', () => ({
  ForesightCreativeRepository: { listDiagnosticInputs: mocks.list },
}));

import { GET } from '../route';

describe('creative diagnostics route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({ user: { businessId: 'business-1', userId: 7 } });
    mocks.list.mockResolvedValue([]);
  });

  it('uses the session tenant and exact fourteen-day evidence window', async () => {
    const response = await GET(new Request('http://localhost/api/foresight/creatives/diagnostics?through=2026-08-01&businessId=other'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith('business-1', '2026-07-19', '2026-08-01', 100);
    expect(body.diagnostics).toMatchObject({ authority: 'platform_diagnostic_non_causal', rankingAllowed: false });
  });

  it('rejects a missing or invalid complete-day boundary before querying', async () => {
    const response = await GET(new Request('http://localhost/api/foresight/creatives/diagnostics'));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
