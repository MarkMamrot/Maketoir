import { NextResponse } from 'next/server';

import { salesAssistantRepository } from './repository';
import { getOrCreateProspectSession, isSameOriginRequest, networkFingerprint, type ProspectSessionCookie } from './session';

export class PublicRouteError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfter?: number) {
    super(message);
  }
}

export async function readBoundedJson(request: Request, maxBytes = 20_000): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new PublicRouteError('Request body is too large.', 413);
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new PublicRouteError('Request body is too large.', 413);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new PublicRouteError('A valid JSON object is required.', 400);
  }
}

export function publicSession(request: Request) {
  return getOrCreateProspectSession(request.headers.get('cookie'));
}

export function applyProspectCookie(response: NextResponse, cookie: ProspectSessionCookie | null): NextResponse {
  if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

export function requireSameOrigin(request: Request): void {
  if (!isSameOriginRequest(request)) throw new PublicRouteError('Cross-origin request rejected.', 403);
}

export async function enforcePublicRateLimits(input: {
  request: Request;
  sessionId: string;
  operation: string;
  sessionLimit: number;
  networkLimit: number;
  windowSeconds: number;
  dailySessionLimit?: number;
  dailyNetworkLimit?: number;
}): Promise<void> {
  const fingerprint = networkFingerprint(input.request);
  const checks = [
    { rateKey: `session:${input.sessionId}`, operation: input.operation, limit: input.sessionLimit, windowSeconds: input.windowSeconds },
    { rateKey: `network:${fingerprint}`, operation: input.operation, limit: input.networkLimit, windowSeconds: input.windowSeconds },
  ];
  if (input.dailySessionLimit) checks.push({ rateKey: `session:${input.sessionId}`, operation: `${input.operation}_daily`, limit: input.dailySessionLimit, windowSeconds: 86_400 });
  if (input.dailyNetworkLimit) checks.push({ rateKey: `network:${fingerprint}`, operation: `${input.operation}_daily`, limit: input.dailyNetworkLimit, windowSeconds: 86_400 });
  for (const check of checks) {
    const result = await salesAssistantRepository.consumeRateLimit(check);
    if (!result.allowed) throw new PublicRouteError('Too many requests. Please try again later.', 429, result.retryAfterSeconds);
  }
}

export function publicErrorResponse(error: unknown): NextResponse {
  if (error instanceof PublicRouteError) {
    const response = NextResponse.json({ error: error.message }, { status: error.status });
    if (error.retryAfter) response.headers.set('Retry-After', String(error.retryAfter));
    return response;
  }
  const message = error instanceof Error ? error.message : 'Request failed.';
  const validation = /required|valid|characters or fewer|not found for this session/i.test(message);
  return NextResponse.json({ error: validation ? message : 'The request could not be completed.' }, { status: validation ? 400 : 500 });
}
