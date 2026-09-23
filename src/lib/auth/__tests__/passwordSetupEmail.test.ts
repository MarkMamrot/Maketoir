import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  send: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/services/MySQLService', () => ({ execute: mocks.execute }));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { sendPasswordSetupEmail } from '../passwordSetupEmail';

describe('sendPasswordSetupEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'Solvantis <accounts@example.com>';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    mocks.execute.mockResolvedValue({});
    mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  it('expires old tokens and sends a first-time password link', async () => {
    await sendPasswordSetupEmail({
      userId: 42,
      email: 'NEW.USER@EXAMPLE.COM ',
      name: 'New User',
      businessId: 'biz-1',
      purpose: 'set',
    });

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.execute.mock.calls[0]).toEqual([
      expect.stringContaining('UPDATE password_reset_tokens'),
      [42],
    ]);
    expect(mocks.execute.mock.calls[1][1][0]).toBe(42);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Solvantis <accounts@example.com>',
      to: 'new.user@example.com',
      subject: 'Set your Solvantis password',
      html: expect.stringMatching(/https:\/\/app\.example\.com\/reset-password\?token=[a-f0-9]{64}/),
    }));
  });

  it('reports and rejects provider delivery failures', async () => {
    mocks.send.mockResolvedValue({ data: null, error: { message: 'rejected' } });

    await expect(sendPasswordSetupEmail({
      userId: 42,
      email: 'new.user@example.com',
      businessId: 'biz-1',
      purpose: 'set',
    })).rejects.toThrow('password setup email could not be sent');

    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      operation: 'password-setup-email',
      context: expect.objectContaining({ userId: 42, purpose: 'set' }),
    }));
  });

  it('reports missing email configuration', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(sendPasswordSetupEmail({
      userId: 42,
      email: 'new.user@example.com',
      businessId: 'biz-1',
      purpose: 'set',
    })).rejects.toThrow('Email service is not configured');

    expect(mocks.reportRuntimeIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'biz-1',
      title: 'Password setup email service is not configured',
    }));
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});