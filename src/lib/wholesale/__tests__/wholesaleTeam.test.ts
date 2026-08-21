import { describe, expect, it } from 'vitest';
import {
  canInviteWholesaleRole,
  canRemoveWholesaleMember,
  normalizeWholesaleTeamEmail,
  normalizeWholesaleTeamRole,
} from '../wholesaleTeam';

describe('wholesale team policy', () => {
  it('normalizes exact approved-contact emails', () => {
    expect(normalizeWholesaleTeamEmail(' Buyer@Example.com ')).toBe('buyer@example.com');
  });

  it('allows owners to invite admins or buyers, and admins to invite buyers only', () => {
    expect(canInviteWholesaleRole('owner', 'admin')).toBe(true);
    expect(canInviteWholesaleRole('owner', 'buyer')).toBe(true);
    expect(canInviteWholesaleRole('admin', 'buyer')).toBe(true);
    expect(canInviteWholesaleRole('admin', 'admin')).toBe(false);
    expect(canInviteWholesaleRole('owner', 'owner')).toBe(false);
  });

  it('prevents admins from removing owners or peer admins', () => {
    expect(canRemoveWholesaleMember('admin', 'buyer')).toBe(true);
    expect(canRemoveWholesaleMember('admin', 'admin')).toBe(false);
    expect(canRemoveWholesaleMember('admin', 'owner')).toBe(false);
  });

  it('rejects malformed emails and roles', () => {
    expect(() => normalizeWholesaleTeamEmail('not-an-email')).toThrow('valid approved');
    expect(() => normalizeWholesaleTeamRole('manager')).toThrow('valid account role');
  });
});