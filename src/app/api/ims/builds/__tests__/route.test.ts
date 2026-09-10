import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: null as null | { businessId: string; tier: string; userId: number; name: string; email: string },
  complete: vi.fn(),
  list: vi.fn(),
  reportRuntimeIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: vi.fn(() => mocks.session) }));
vi.mock('@/lib/ims/builds/buildService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ims/builds/buildService')>('@/lib/ims/builds/buildService');
  return {
    ...actual,
    completeProductBuildBatch: mocks.complete,
    listProductBuildBatches: mocks.list,
  };
});
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportRuntimeIssue }));

import { ProductBuildValidationError } from '@/lib/ims/builds/domain';
import { GET, POST } from '../route';
import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';

describe('product build routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = null;
  });

  it('requires an IMS session', async () => {
    const response = await GET(new NextRequest('http://localhost/api/ims/builds'));
    expect(response.status).toBe(401);
  });

  it('keeps Advisor accounts read-only', async () => {
    mocks.session = { businessId: 'business-1', tier: 'Advisor', userId: 2, name: 'Advisor', email: 'advisor@example.com' };
    const response = await POST(new NextRequest('http://localhost/api/ims/builds', {
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(response.status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('maps expected request validation to 400 without reporting a runtime issue', async () => {
    mocks.session = { businessId: 'business-1', tier: 'Admin', userId: 1, name: 'Admin', email: 'admin@example.com' };
    mocks.complete.mockRejectedValueOnce(new ProductBuildValidationError('operationKey is required.'));
    const response = await POST(new NextRequest('http://localhost/api/ims/builds', {
      method: 'POST',
      body: JSON.stringify({ locationId: 1, builds: [] }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'operationKey is required.' });
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });

  it('returns an actionable FIFO shortage as a 409 without reporting a runtime issue', async () => {
    mocks.session = { businessId: 'business-1', tier: 'Admin', userId: 1, name: 'Admin', email: 'admin@example.com' };
    mocks.complete.mockRejectedValueOnce(new FifoCostingConflict('FIFO layers cover 5 units, but 6 are required. Reconcile the missing 1 units before retrying.'));

    const response = await POST(new NextRequest('http://localhost/api/ims/builds', {
      method: 'POST',
      body: JSON.stringify({ locationId: 7, operationKey: 'build-1', builds: [{ outputVariantId: 'kit', quantity: 3 }] }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'FIFO layers cover 5 units, but 6 are required. Reconcile the missing 1 units before retrying.',
      code: 'FIFO_COSTING_CONFLICT',
    });
    expect(mocks.reportRuntimeIssue).not.toHaveBeenCalled();
  });
});