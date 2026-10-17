import { OnlineSyncValidationError } from './onlineSyncPolicy';
import type { OnlineSyncFailureCode } from './onlineSyncJobs';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function classifyOnlineSyncFailure(error: unknown, now = Date.now()): {
  code: OnlineSyncFailureCode; retryAfterSeconds: number; providerStatus: number | null;
} {
  const value = record(error);
  const response = record(value.response);
  const status = Number(value.statusCode ?? response.statusCode ?? response.status);
  const headers = record(response.headers);
  const retry = headers['retry-after'];
  let retryAfterSeconds = 0;
  if (typeof retry === 'number' || typeof retry === 'string') {
    const seconds = Number(retry);
    if (Number.isFinite(seconds) && seconds >= 0) retryAfterSeconds = Math.ceil(seconds);
    else if (typeof retry === 'string') {
      const date = Date.parse(retry);
      if (Number.isFinite(date)) retryAfterSeconds = Math.max(0, Math.ceil((date - now) / 1000));
    }
  }
  let code: OnlineSyncFailureCode = 'operational_failure';
  if (status === 429) code = 'provider_rate_limit';
  else if (status >= 500 && status <= 599) code = 'provider_unavailable';
  else if (error instanceof OnlineSyncValidationError) {
    code = error.message.includes('read_all_orders') || error.message.includes('order read access')
      ? 'history_unavailable' : 'source_conflict';
  }
  return {
    code, retryAfterSeconds,
    providerStatus: Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : null,
  };
}
