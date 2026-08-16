import { describe, expect, it } from 'vitest';
import {
  createOpaqueMfaToken,
  createRecoveryCodes,
  hashMfaValue,
  hashRecoveryCode,
  recoveryCodeMatches,
} from '../mfaTokens';

describe('MFA token helpers', () => {
  it('creates unique, display-friendly recovery codes', () => {
    const codes = createRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-F]{5}(?:-[0-9A-F]{5}){3}$/);
  });

  it('normalizes recovery code case, spaces, and separators before hashing', () => {
    const code = 'ABCDE-12345-FEDCB-98765';
    const hash = hashRecoveryCode(code);

    expect(recoveryCodeMatches('abcde 12345 fedcb 98765', hash)).toBe(true);
    expect(recoveryCodeMatches('ABCDE-12345-FEDCB-98766', hash)).toBe(false);
    expect(recoveryCodeMatches(code, 'not-a-valid-hash')).toBe(false);
  });

  it('creates opaque bearer tokens and stores only their SHA-256 hash', () => {
    const first = createOpaqueMfaToken();
    const second = createOpaqueMfaToken();

    expect(first.token).not.toBe(first.tokenHash);
    expect(first.tokenHash).toBe(hashMfaValue(first.token));
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it('rejects invalid recovery-code counts', () => {
    expect(() => createRecoveryCodes(0)).toThrow();
    expect(() => createRecoveryCodes(21)).toThrow();
  });
});