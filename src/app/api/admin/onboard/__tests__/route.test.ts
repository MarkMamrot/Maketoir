import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  execute: vi.fn(),
  findByEmail: vi.fn(),
  createUser: vi.fn(),
  provisionBusinessIms: vi.fn(),
  cleanupFailedBusinessProvision: vi.fn(),
  reportRuntimeIssue: vi.fn(),
  enroll: vi.fn(),
  sendPasswordSetupEmail: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/services/MySQLService', () => ({ execute: mocks.execute }));
vi.mock('@/lib/db/UsersRepository', () => ({
  UsersRepository: { findByEmail: mocks.findByEmail, create: mocks.createUser },
}));
vi.mock('@/lib/ims/provisionBusiness', () => ({
  ImsProvisioningError: class extends Error {},
  provisionBusinessIms: mocks.provisionBusinessIms,
  cleanupFailedBusinessProvision: mocks.cleanupFailedBusinessProvision,
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));
vi.mock('@/lib/auth/businessMemberships', () => ({ enrollUserInBusiness: mocks.enroll }));
vi.mock('@/lib/auth/passwordSetupEmail', () => ({ sendPasswordSetupEmail: mocks.sendPasswordSetupEmail }));

import { POST } from '../route';

function request() {
  return new Request('http://localhost/api/admin/onboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'New Retailer',
      ownerEmail: 'owner@example.com',
      ownerName: 'Retail Owner',
      ownerPasswordMode: 'email',
    }),
  });
}

describe('POST /api/admin/onboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockReturnValue({
      get: () => ({ value: JSON.stringify({ userId: 9, tier: 'SuperAdmin' }) }),
    });
    mocks.execute.mockResolvedValue({});
    mocks.findByEmail.mockResolvedValue(null);
    mocks.createUser.mockResolvedValue(42);
    mocks.provisionBusinessIms.mockResolvedValue({ imsDbName: 'readyedu_NewRetailerIMS', schemaCreated: true });
    mocks.enroll.mockResolvedValue(undefined);
    mocks.sendPasswordSetupEmail.mockResolvedValue(undefined);
  });

  it('creates the owner and sends a first-time password setup email', async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, ownerCreated: true, ownerEmailSent: true });
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'owner@example.com',
      password: expect.any(String),
      tier: 'Admin',
    }));
    expect(mocks.enroll).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      tier: 'Admin',
      enrolledByUserId: 9,
    }));
    expect(mocks.sendPasswordSetupEmail).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      email: 'owner@example.com',
      purpose: 'set',
    }));
  });

  it('keeps the provisioned business when owner email delivery fails', async () => {
    mocks.sendPasswordSetupEmail.mockRejectedValue(new Error('The password setup email could not be sent.'));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      ownerCreated: true,
      ownerEmailSent: false,
      ownerEmailWarning: 'The password setup email could not be sent.',
    });
    expect(mocks.cleanupFailedBusinessProvision).not.toHaveBeenCalled();
  });
});