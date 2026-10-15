import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPasswordValidation, PASSWORD_MAX_AGE_MS, passwordExpiresAt, passwordRequiresRenewal } from '../passwordPolicy';

describe('shared platform password policy', () => {
  it('accepts a compliant 12-character password', () => {
    expect(getPasswordValidation('FreshReset9!')).toMatchObject({ isValid: true, message: '' });
  });

  it.each([undefined, null, 123, {}, [], '', 'Short9!', 'lowercaseonly9!', 'UPPERCASEONLY9!', 'NoNumbersHere!', 'NoSpecialHere9', 'OnlyWhitespace9 '])(
    'rejects invalid or incomplete passwords: %j', password => {
      expect(getPasswordValidation(password).isValid).toBe(false);
    },
  );

  it('does not count whitespace as a special character', () => {
    expect(getPasswordValidation('OnlyWhitespace9 ').failedRequirements.some(item => item.id === 'special')).toBe(true);
  });

  it('checks username, every name component, and email independently', () => {
    expect(getPasswordValidation('SECRETuserName9!', 'UserName').isValid).toBe(false);
    expect(getPasswordValidation('FreshMorgan9!', 'operator', 'Morgan Person').isValid).toBe(false);
    expect(getPasswordValidation('FreshPERSON9!', 'operator', 'Morgan Person').isValid).toBe(false);
    expect(getPasswordValidation('X9!operator@example.com', 'different-user', 'Morgan Person', 'operator@example.com').isValid).toBe(false);
  });

  it('enforces bcrypt UTF-8 boundaries without silently truncating', () => {
    expect(getPasswordValidation(`Aa1!${'x'.repeat(68)}`).isValid).toBe(true);
    expect(getPasswordValidation(`Aa1!${'x'.repeat(69)}`).isValid).toBe(false);
    expect(getPasswordValidation(`Aa1!${'é'.repeat(34)}`).isValid).toBe(true);
    expect(getPasswordValidation(`Aa1!${'é'.repeat(35)}`).isValid).toBe(false);
    expect(getPasswordValidation('FreshReset9!\u0000').isValid).toBe(false);
  });
});

describe('password age', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it.each([null, undefined])('requires immediate renewal when the password age is unknown', date => {
    expect(passwordExpiresAt(date)).toBeNull();
    expect(passwordRequiresRenewal(date)).toBe(true);
  });

  it('expires at exactly 365 days, not a calendar-year approximation', () => {
    const changed = new Date(Date.now() - PASSWORD_MAX_AGE_MS);
    expect(passwordExpiresAt(changed)).toBe(new Date().toISOString());
    expect(passwordRequiresRenewal(changed)).toBe(true);
    expect(passwordRequiresRenewal(new Date(changed.getTime() + 1))).toBe(false);
    expect(passwordRequiresRenewal(new Date(changed.getTime() - 1))).toBe(true);
  });

  it('rejects corrupt or future stored change dates', () => {
    expect(() => passwordRequiresRenewal('not-a-date')).toThrow('invalid');
    expect(() => passwordRequiresRenewal(new Date(Date.now() + 1))).toThrow('future');
  });
});
