import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  imsQuery: vi.fn(),
  imsExecute: vi.fn(),
  query: vi.fn(),
  getBusinessInfo: vi.fn(),
  reportIssue: vi.fn(),
}));

vi.mock('@/lib/auth/imsSession', () => ({ getImsSession: mocks.getSession }));
vi.mock('@/services/IMSMySQLService', () => ({ imsQuery: mocks.imsQuery, imsExecute: mocks.imsExecute }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query }));
vi.mock('@/lib/db/BusinessInfoRepository', () => ({
  BusinessInfoRepository: { get: mocks.getBusinessInfo, upsert: vi.fn() },
}));
vi.mock('@/lib/runtimeIssues', () => ({ reportRuntimeIssue: mocks.reportIssue }));

import { GET, PUT } from '../route';

describe('GET /api/onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ businessId: 'business-1' });
    mocks.query.mockResolvedValue([{ c: 1 }]);
    mocks.getBusinessInfo.mockResolvedValue(null);
    mocks.reportIssue.mockResolvedValue(1);
    mocks.imsQuery.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('SELECT `key`, value') ? [] : [{ c: 0 }]),
    );
  });

  it('returns a valid onboarding state when tenant tables are empty', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.counts).toEqual({
      users: 1,
      locations: 0,
      products: 0,
      salesOrders: 0,
      purchaseOrders: 0,
      stockRows: 0,
    });
    expect(mocks.reportIssue).not.toHaveBeenCalled();
  });

  it('reports database failures instead of presenting them as zero data', async () => {
    const databaseError = new Error('Table does not exist');
    mocks.imsQuery.mockRejectedValue(databaseError);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Onboarding progress could not be loaded.' });
    expect(mocks.reportIssue).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      source: 'onboarding',
      operation: 'load_progress',
      error: databaseError,
    }));
  });

  it('persists a valid manually completed step', async () => {
    mocks.imsQuery.mockResolvedValue([{ value: '["business_profile"]' }]);
    mocks.imsExecute.mockResolvedValue(undefined);

    const response = await PUT(new Request('http://localhost/api/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completeStep: 'operations_tax' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_settings'),
      ['business-1', 'onboarding_completed_steps', '["business_profile","operations_tax"]'],
    );
  });

  it('reopens a valid manually completed step', async () => {
    mocks.imsQuery.mockResolvedValue([{ value: '["business_profile","operations_tax"]' }]);
    mocks.imsExecute.mockResolvedValue(undefined);

    const response = await PUT(new Request('http://localhost/api/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reopenStep: 'business_profile' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_settings'),
      ['business-1', 'onboarding_completed_steps', '["operations_tax"]'],
    );
  });

  it('rejects unknown step IDs without writing progress', async () => {
    const response = await PUT(new Request('http://localhost/api/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completeStep: 'unknown_step' }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid onboarding step' });
    expect(mocks.imsQuery).not.toHaveBeenCalled();
    expect(mocks.imsExecute).not.toHaveBeenCalled();
  });

  it('reports complete when every step is manually completed', async () => {
    const completedSteps = [
      'business_profile', 'operations_tax', 'online_shop', 'accounting', 'users', 'locations',
      'products', 'sales_orders', 'purchase_orders', 'opening_stock', 'pos_ready',
    ];
    mocks.imsQuery.mockImplementation((sql: string) => Promise.resolve(
      sql.includes('SELECT `key`, value')
        ? [{ key: 'onboarding_completed_steps', value: JSON.stringify(completedSteps) }]
        : [{ c: 0 }],
    ));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.complete).toBe(true);
    expect(body.steps).toHaveLength(completedSteps.length);
    expect(body.steps.every((step: { completed: boolean }) => step.completed)).toBe(true);
  });
});