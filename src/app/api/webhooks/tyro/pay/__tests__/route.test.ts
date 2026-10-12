import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), parse: vi.fn(), retrieve: vi.fn(), config: vi.fn(), claim: vi.fn(), findByProvider: vi.fn(),
  findByOrder: vi.fn(), update: vi.fn(), finish: vi.fn(), report: vi.fn(),
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.report }));
vi.mock('@/lib/tyro/payApi', () => ({
  verifyTyroWebhookSignature: mocks.verify, parseTyroWebhookEvent: mocks.parse,
  getTyroPayRequest: mocks.retrieve, getTyroPayConfig: mocks.config,
}));
vi.mock('@/lib/tyro/payRepository', () => ({ TyroPayRepository: {
  claimWebhookEvent: mocks.claim, findByProviderRequestId: mocks.findByProvider, findByOrderId: mocks.findByOrder,
  updateFromProvider: mocks.update, finishWebhookEvent: mocks.finish,
} }));

import { POST } from '../route';

const event = { type: 'PAY_REQUEST_SUCCESS', data: {
  id: 'pay-1', uri: 'https://api.tyro.com/connect/pay/requests/pay-1', resource: 'payrequest',
} };
const request = () => new Request('http://localhost/api/webhooks/tyro/pay', {
  method: 'POST', headers: { 'Tyro-Connect-Signature': 'signature' }, body: JSON.stringify(event),
});

describe('Tyro Pay webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockReturnValue(true);
    mocks.parse.mockReturnValue(event);
    mocks.claim.mockResolvedValue(true);
    mocks.config.mockReturnValue({ locationId: 'tc-test-3000' });
    mocks.retrieve.mockResolvedValue({ id: 'pay-1', locationId: 'tc-test-3000', origin: { orderId: 'SV-CERT-1' },
      status: 'SUCCESS', total: { amount: 1250, currency: 'AUD' } });
    mocks.findByProvider.mockResolvedValue({ id: 'local-1', businessId: 'business-1', orderId: 'SV-CERT-1',
      locationId: 'tc-test-3000', amountCents: 1250, currencyCode: 'AUD' });
  });

  it('rejects an invalid HMAC before parsing or persistence', async () => {
    mocks.verify.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('retrieves the authoritative Pay Request before updating status', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledWith('pay-1');
    expect(mocks.update).toHaveBeenCalledWith({ id: 'local-1', tyroPayRequestId: 'pay-1', status: 'SUCCESS' });
    expect(mocks.finish).toHaveBeenCalledWith({ event, businessId: 'business-1' });
  });

  it('acknowledges duplicate events without repeating provider or database work', async () => {
    mocks.claim.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, replayed: true });
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});