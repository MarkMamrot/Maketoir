import { generate, generateSecret, generateURI, verify } from 'otplib';

const TOTP_ISSUER = 'Solvantis';
const TOTP_PERIOD_SECONDS = 30;

export interface TotpVerificationResult {
  valid: boolean;
  timeStep: number | null;
}

export function createTotpSecret(): string {
  return generateSecret();
}

export function createTotpUri(email: string, secret: string): string {
  return generateURI({
    issuer: TOTP_ISSUER,
    label: email.trim().toLowerCase(),
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
  });
}

export async function generateTotpCode(secret: string, epochSeconds?: number): Promise<string> {
  return generate({
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    ...(epochSeconds == null ? {} : { epoch: epochSeconds }),
  });
}

export async function verifyTotpCode(input: {
  secret: string;
  code: string;
  epochSeconds?: number;
  afterTimeStep?: number | null;
}): Promise<TotpVerificationResult> {
  const code = input.code.trim();
  if (!/^\d{6}$/.test(code)) return { valid: false, timeStep: null };

  const result = await verify({
    secret: input.secret,
    token: code,
    algorithm: 'sha1',
    digits: 6,
    period: TOTP_PERIOD_SECONDS,
    epochTolerance: TOTP_PERIOD_SECONDS,
    ...(input.epochSeconds == null ? {} : { epoch: input.epochSeconds }),
    ...(input.afterTimeStep == null ? {} : { afterTimeStep: input.afterTimeStep }),
  });

  return result.valid
    ? { valid: true, timeStep: result.timeStep }
    : { valid: false, timeStep: null };
}