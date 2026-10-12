import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), config: vi.fn(), create: vi.fn(), retrieve: vi.fn(), createPending: vi.fn(), attach: vi.fn(),
  findById: vi.fn(), update: vi.fn(), markFailed: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/sessionUtils', () => ({ requireSuperAdminTier: mocks.auth }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/tyro/payApi', () => ({
  getTyroPayConfig: mocks.config, createTyroPayRequest: mocks.create, getTyroPayRequest: mocks.retrieve,
}));
vi.mock('@/lib/tyro/payRepository', () => ({ TyroPayRepository: {
  createPending: mocks.createPending, attachProviderRequest: mocks.attach, findById: mocks.findById,
  updateFromProvider: mocks.update, markCreateFailed: mocks.markFailed,
} }));

import { POST } from '../route';

describe('Tyro certification Pay Request route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockReturnValue({ user: { userId: 7, businessId: 'business-1' } });
    mocks.config.mockReturnValue({ environment: 'sandbox', locationId: 'tc-test-3000' });
    mocks.markFailed.mockResolvedValue(undefined);
    mocks.report.mockResolvedValue(undefined);
    mocks.create.mockImplementation(async ({ orderId, amountCents }) => ({
      id: 'pay-1', paySecret: 'temporary-secret', locationId: 'tc-test-3000', origin: { orderId },
      status: 'AWAITING_PAYMENT_INPUT', total: { amount: amountCents, currency: 'AUD' },
    }));
  });

  it('requires SuperAdmin before creating a Pay Request', async () => {
    mocks.auth.mockReturnValue({ response: new Response(null, { status: 403 }) });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ amountCents: 100 }) }));
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('persists routing identity without storing the temporary pay secret', async () => {
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ amountCents: 1250, reference: 'Certification' }) }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({ payRequestId: 'pay-1', paySecret: 'temporary-secret', liveMode: false }));
    expect(mocks.createPending).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'business-1', amountCents: 1250 }));
    expect(mocks.attach).toHaveBeenCalledWith(expect.objectContaining({ tyroPayRequestId: 'pay-1' }));
    expect(JSON.stringify(mocks.createPending.mock.calls)).not.toContain('temporary-secret');
    expect(JSON.stringify(mocks.attach.mock.calls)).not.toContain('temporary-secret');
  });

  it('refuses production credentials on the certification endpoint', async () => {
    mocks.config.mockReturnValue({ environment: 'production', locationId: 'live-location' });
    const response = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ amountCents: 100 }) }));
    expect(response.status).toBe(500);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});