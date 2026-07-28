import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImsExecute } = vi.hoisted(() => ({ mockImsExecute: vi.fn() }));

vi.mock('@/services/IMSMySQLService', () => ({
  imsExecute: mockImsExecute,
}));

import { recordDraftEditLearning } from '../learning';

describe('customer-service learning evidence capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImsExecute.mockResolvedValue({ affectedRows: 1 });
  });

  it('captures unchanged sent replies as style examples', async () => {
    await recordDraftEditLearning({
      businessId: 'biz-1',
      draftId: 10,
      originalBody: 'Thanks for your email. We can help.',
      finalBody: 'Thanks for your email. We can help.',
    });

    expect(mockImsExecute).toHaveBeenCalledOnce();
    const [, params] = mockImsExecute.mock.calls[0];
    expect(String(params[2])).toContain('SENT RESPONSE STYLE EXAMPLE');
  });

  it('captures changed replies with original and final sections', async () => {
    await recordDraftEditLearning({
      businessId: 'biz-1',
      draftId: 11,
      originalBody: 'We will ship soon.',
      finalBody: 'We will ship by Friday and send tracking.',
    });

    expect(mockImsExecute).toHaveBeenCalledOnce();
    const [, params] = mockImsExecute.mock.calls[0];
    expect(String(params[2])).toContain('ORIGINAL AI DRAFT');
    expect(String(params[2])).toContain('FINAL SENT RESPONSE');
  });
});