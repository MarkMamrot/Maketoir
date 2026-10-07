import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: JSON.stringify({ businessId: 'test-business' }) }) }) }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));

import { POST } from '../route';

describe('layby email receipts', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('RESEND_FROM_EMAIL', 'receipts@example.test');
    send.mockResolvedValue({ data: { id: 'receipt' }, error: null });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  async function receipt(status: string, payments: { method: string; amount: number }[]) {
    const response = await POST(new Request('http://localhost/api/pos/receipt/email', {
      method: 'POST',
      body: JSON.stringify({ email: 'customer@example.test', sale: { id: 1, created_at: '2026-10-07 13:40:00', sale_type: 'layby', status, total: 129.95, items: [], payments } }),
    }));
    expect(response.status).toBe(200);
    return send.mock.calls[0][0].html as string;
  }

  it('shows actual payments and outstanding balance', async () => {
    const html = await receipt('layby_active', [{ method: 'Card', amount: 26 }]);
    expect(html).toContain('Layby payments received');
    expect(html).toContain('$26.00');
    expect(html).toContain('Balance owing');
    expect(html).toContain('$103.95');
  });

  it('shows cancellation refund and retained fee instead of debt', async () => {
    const html = await receipt('voided', [{ method: 'Card', amount: 26 }, { method: 'Card', amount: -13 }]);
    expect(html).toContain('Layby cancelled');
    expect(html).toContain('Refund issued');
    expect(html).toContain('Retained cancellation fee');
    expect(html).toContain('$13.00');
    expect(html).not.toContain('Balance owing');
  });
});