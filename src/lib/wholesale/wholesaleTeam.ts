export type WholesaleTeamRole = 'owner' | 'admin' | 'buyer';

export class WholesaleTeamValidationError extends Error {}

export function normalizeWholesaleTeamEmail(value: unknown): string {
  if (typeof value !== 'string') throw new WholesaleTeamValidationError('Enter an approved wholesale email.');
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new WholesaleTeamValidationError('Enter a valid approved wholesale email.');
  }
  return email;
}

export function normalizeWholesaleTeamRole(value: unknown): WholesaleTeamRole {
  if (value !== 'owner' && value !== 'admin' && value !== 'buyer') {
    throw new WholesaleTeamValidationError('Select a valid account role.');
  }
  return value;
}

export function canInviteWholesaleRole(actorRole: WholesaleTeamRole, targetRole: WholesaleTeamRole): boolean {
  if (targetRole === 'owner') return false;
  return actorRole === 'owner' || (actorRole === 'admin' && targetRole === 'buyer');
}

export function canRemoveWholesaleMember(actorRole: WholesaleTeamRole, targetRole: WholesaleTeamRole): boolean {
  return actorRole === 'owner' || (actorRole === 'admin' && targetRole === 'buyer');
}