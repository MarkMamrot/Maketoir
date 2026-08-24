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
      brands: 0,
      suppliers: 0,
      products: 0,
      salesOrders: 0,
      purchaseOrders: 0,
      stockRows: 0,
    });
    expect(mocks.reportIssue).not.toHaveBeenCalled();
  });

  it('does not complete confirmation steps from fresh-tenant defaults', async () => {
    const response = await GET();
    const body = await response.json();
    const steps = new Map(body.steps.map((step: { id: string; completed: boolean }) => [step.id, step.completed]));

    expect(steps.get('operations')).toBe(false);
    expect(steps.get('tax')).toBe(false);
    expect(steps.get('integrations')).toBe(false);
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
      body: JSON.stringify({ completeStep: 'operations' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_settings'),
      ['business-1', 'onboarding_completed_steps', '["business_profile","operations"]'],
    );
  });

  it('persists allowlisted onboarding settings before completing a step', async () => {
    mocks.imsQuery.mockResolvedValue([]);
    mocks.imsExecute.mockResolvedValue(undefined);

    const response = await PUT(new Request('http://localhost/api/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: { use_foreign_currencies: 'no', unsupported_setting: 'ignored' },
        completeStep: 'operations',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_settings'),
      ['business-1', 'use_foreign_currencies', 'no'],
    );
    expect(mocks.imsExecute).not.toHaveBeenCalledWith(
      expect.any(String),
      ['business-1', 'unsupported_setting', 'ignored'],
    );
  });

  it('stores structured identity fields and a compatible combined address', async () => {
    mocks.imsQuery.mockResolvedValue([]);
    mocks.imsExecute.mockResolvedValue(undefined);

    const response = await PUT(new Request('http://localhost/api/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          business_address_line1: '123 Main Street',
          business_address_line2: 'Suite 4',
          business_suburb: 'Sydney',
          business_state: 'NSW',
          business_postcode: '2000',
          business_country: 'Australia',
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.imsExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ims_settings'),
      ['business-1', 'business_address', '123 Main Street, Suite 4, Sydney NSW 2000, Australia'],
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
      ['business-1', 'onboarding_completed_steps', '["operations","tax"]'],
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
      'business_profile', 'operations', 'tax', 'integrations', 'users', 'locations',
      'brands', 'suppliers', 'products', 'sales_orders', 'purchase_orders', 'opening_stock', 'pos_ready',
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