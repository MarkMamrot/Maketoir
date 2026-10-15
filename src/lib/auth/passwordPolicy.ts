export const PASSWORD_REQUIREMENTS = [
  {
    id: 'length',
    label: 'At least 12 characters',
    test: (password: string) => password.length >= 12,
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter',
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter',
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: 'number',
    label: 'One number',
    test: (password: string) => /\d/.test(password),
  },
  {
    id: 'special',
    label: 'One special character',
    test: (password: string) => /[^A-Za-z0-9\s]/.test(password),
  },
] as const;

export class PasswordPolicyValidationError extends Error {}
export class PasswordRenewalRequiredError extends Error {
  constructor() { super('Your password must be renewed. Use Forgot password, then sign in again.'); }
}

export const PASSWORD_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function getPasswordValidation(password: unknown, username?: string | null, name?: string | null, email?: string | null) {
  const failedRequirements: Array<{ id: string; label: string }> = PASSWORD_REQUIREMENTS
    .filter(requirement => typeof password !== 'string' || !requirement.test(password));
  if (typeof password === 'string' && (new TextEncoder().encode(password).length > 72 || /[\u0000-\u001f\u007f]/.test(password))) {
    failedRequirements.push({ id: 'encoding', label: 'No control characters and at most 72 UTF-8 bytes' });
  }
  const identifiers = [
    ...(typeof username === 'string' && username.trim() ? [username.trim()] : []),
    ...(typeof email === 'string' && email.trim() ? [email.trim()] : []),
    ...(typeof name === 'string' ? name.trim().split(/[\s._'-]+/).filter(Boolean) : []),
  ];
  if (typeof password === 'string' && identifiers.some(identifier => password.toLowerCase().includes(identifier.toLowerCase()))) {
    failedRequirements.push({ id: 'username', label: 'Must not contain your name, username or sign-in email' });
  }

  return {
    isValid: failedRequirements.length === 0,
    failedRequirements,
    message: failedRequirements.length
      ? `Password requirements: ${failedRequirements.map(requirement => requirement.label.toLowerCase()).join(', ')}.`
      : '',
  };
}

export function passwordExpiresAt(changedAt: Date | string | null | undefined): string | null {
  if (changedAt == null) return null;
  const changed = new Date(changedAt);
  if (!Number.isFinite(changed.getTime())) throw new Error('Stored password-change date is invalid.');
  return new Date(changed.getTime() + PASSWORD_MAX_AGE_MS).toISOString();
}

export function passwordRequiresRenewal(changedAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (changedAt != null && new Date(changedAt).getTime() > now) throw new Error('Stored password-change date is in the future.');
  const expiresAt = passwordExpiresAt(changedAt);
  return !expiresAt || Date.parse(expiresAt) <= now;
}