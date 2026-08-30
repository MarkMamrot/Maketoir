import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@/services/MySQLService', () => ({ query: mocks.query, execute: mocks.execute }));

import { listBusinessMemberships, selectLoginMembership } from '../businessMemberships';

describe('business memberships', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps per-business tiers and orders active memberships for login selection', async () => {
    mocks.query.mockResolvedValue([
      { user_id: 4, business_id: 'beta', business_name: 'Beta', tier: 'Advisor', is_default: 0, last_active_at: '2026-08-30T01:00:00.000Z' },
      { user_id: 4, business_id: 'alpha', business_name: 'Alpha', tier: 'Admin', is_default: 1, last_active_at: null },
    ]);

    const memberships = await listBusinessMemberships(4);

    expect(selectLoginMembership(memberships)).toMatchObject({ businessId: 'beta', tier: 'Advisor' });
    expect(memberships[1]).toMatchObject({ businessId: 'alpha', tier: 'Admin', isDefault: true });
  });

  it('uses the default membership when none has been active', () => {
    expect(selectLoginMembership([
      { userId: 4, businessId: 'alpha', businessName: 'Alpha', tier: 'Admin', isDefault: false, lastActiveAt: null },
      { userId: 4, businessId: 'beta', businessName: 'Beta', tier: 'StandardUser', isDefault: true, lastActiveAt: null },
    ])?.businessId).toBe('beta');
  });
});