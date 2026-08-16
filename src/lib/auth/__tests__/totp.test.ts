import { describe, expect, it } from 'vitest';
import { createTotpSecret, createTotpUri, generateTotpCode, verifyTotpCode } from '../totp';

const EPOCH = 1_786_873_260;

describe('TOTP helpers', () => {
  it('creates an authenticator-compatible secret and provisioning URI', () => {
    const secret = createTotpSecret();
    const uri = new URL(createTotpUri('Admin@Example.com ', secret));

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.hostname).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toContain('Solvantis:admin@example.com');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('issuer')).toBe('Solvantis');
  });

  it('verifies a current six-digit code and returns its time step', async () => {
    const secret = createTotpSecret();
    const code = await generateTotpCode(secret, EPOCH);
    const result = await verifyTotpCode({ secret, code, epochSeconds: EPOCH });

    expect(code).toMatch(/^\d{6}$/);
    expect(result).toEqual({ valid: true, timeStep: Math.floor(EPOCH / 30) });
  });

  it('accepts one adjacent time step but rejects replay of the accepted step', async () => {
    const secret = createTotpSecret();
    const previousCode = await generateTotpCode(secret, EPOCH - 30);
    const accepted = await verifyTotpCode({ secret, code: previousCode, epochSeconds: EPOCH });

    expect(accepted.valid).toBe(true);
    await expect(verifyTotpCode({
      secret,
      code: previousCode,
      epochSeconds: EPOCH,
      afterTimeStep: accepted.timeStep,
    })).resolves.toEqual({ valid: false, timeStep: null });
  });

  it('rejects malformed codes before cryptographic verification', async () => {
    await expect(verifyTotpCode({ secret: createTotpSecret(), code: '12 3456' }))
      .resolves.toEqual({ valid: false, timeStep: null });
  });
});