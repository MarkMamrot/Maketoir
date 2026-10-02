import { describe, expect, it, vi } from 'vitest';
import { KlaviyoProfileConflictError, reconcileKlaviyoProfile, type KlaviyoProfileReconciliationDependencies } from '../profileReconciliation';

function dependencies(overrides: Partial<KlaviyoProfileReconciliationDependencies> = {}): KlaviyoProfileReconciliationDependencies {
  return {
    loadContact: vi.fn(async () => ({ id: 42, type: 'retail_customer', email: 'Customer@example.com', phone: null, mobile: '0412345678' })),
    loadMapping: vi.fn(async () => null),
    recordLinked: vi.fn(async input => ({ contactId: input.contactId, profileId: input.profileId, externalId: input.externalId, status: 'linked', safeError: null })),
    recordConflict: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('Klaviyo profile reconciliation', () => {
  it('updates a saved linked profile with current contact identity', async () => {
    const deps = dependencies({ loadMapping: vi.fn(async () => ({ contactId: 42, profileId: 'profile-1', externalId: 'old', status: 'linked', safeError: null })) });
    const client = { findProfilesByIdentifier: vi.fn(), createProfile: vi.fn(),
      updateProfile: vi.fn(async (id, profile) => ({ id, ...profile })) };

    await expect(reconcileKlaviyoProfile({ businessId: 'business-1', contactId: 42, client }, deps))
      .resolves.toMatchObject({ id: 'profile-1', email: 'customer@example.com', phoneNumber: '+61412345678' });
    expect(client.findProfilesByIdentifier).not.toHaveBeenCalled();
  });

  it('links one existing profile found across contact identifiers', async () => {
    const deps = dependencies();
    const client = {
      findProfilesByIdentifier: vi.fn(async field => field === 'email' ? [{ id: 'profile-1', email: 'customer@example.com' }] : []),
      createProfile: vi.fn(),
      updateProfile: vi.fn(async (id, profile) => ({ id, ...profile })),
    };

    await expect(reconcileKlaviyoProfile({ businessId: 'business-1', contactId: 42, client }, deps))
      .resolves.toMatchObject({ id: 'profile-1', externalId: 'solvantis:business-1:contact:42' });
    expect(deps.recordLinked).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'profile-1' }));
    expect(client.createProfile).not.toHaveBeenCalled();
  });

  it('persists a conflict and refuses to guess between profiles', async () => {
    const deps = dependencies();
    const client = {
      findProfilesByIdentifier: vi.fn(async field => field === 'email'
        ? [{ id: 'profile-email', email: 'customer@example.com' }]
        : field === 'phone_number' ? [{ id: 'profile-phone', phoneNumber: '+61412345678' }] : []),
      createProfile: vi.fn(), updateProfile: vi.fn(),
    };

    await expect(reconcileKlaviyoProfile({ businessId: 'business-1', contactId: 42, client }, deps))
      .rejects.toBeInstanceOf(KlaviyoProfileConflictError);
    expect(deps.recordConflict).toHaveBeenCalledOnce();
    expect(client.createProfile).not.toHaveBeenCalled();
    expect(client.updateProfile).not.toHaveBeenCalled();
  });
});