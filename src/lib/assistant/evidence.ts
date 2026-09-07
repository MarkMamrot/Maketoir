export type AssistantEvidenceStatus =
  | 'ok'
  | 'no_results'
  | 'invalid_request'
  | 'forbidden'
  | 'unavailable'
  | 'operational_error';

export interface AssistantToolEvidence {
  status: AssistantEvidenceStatus;
  facts: unknown;
  message: string | null;
  truncated: boolean;
}

const SENSITIVE_EVIDENCE_KEYS = new Set([
  'password', 'passphrase', 'secret', 'token', 'accesstoken', 'refreshtoken',
  'cookie', 'authorization', 'email', 'customeremail', 'supplieremail', 'phone',
  'mobile', 'address', 'deliveryaddress', 'billingaddress', 'cardnumber',
  'paymentreference', 'cashier', 'cashierid', 'cashiername', 'actorid', 'actorname',
  'staffid', 'staffname', 'note', 'notes', 'reviewnote', 'operatornote', 'freetext',
]);

function normalizedEvidenceKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLocaleLowerCase('en-AU');
}

export function sanitizeAssistantToolFacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAssistantToolFacts);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_EVIDENCE_KEYS.has(normalizedEvidenceKey(key)))
      .map(([key, child]) => [key, sanitizeAssistantToolFacts(child)]),
  );
}

export function successfulToolEvidence(result: unknown, maxRows?: number): AssistantToolEvidence {
  const noResults = result == null || (Array.isArray(result) && result.length === 0);
  const resultReportsTruncation = Boolean(
    result && typeof result === 'object' && !Array.isArray(result)
    && (result as Record<string, unknown>).truncated === true,
  );
  return {
    status: noResults ? 'no_results' : 'ok',
    facts: sanitizeAssistantToolFacts(result),
    message: noResults ? 'The authorised lookup completed but found no matching records.' : null,
    truncated: resultReportsTruncation || Boolean(maxRows && Array.isArray(result) && result.length >= maxRows),
  };
}

export function failedToolEvidence(
  status: Exclude<AssistantEvidenceStatus, 'ok' | 'no_results'>,
  message: string,
): AssistantToolEvidence {
  return { status, facts: null, message: message.replace(/\s+/g, ' ').trim().slice(0, 300), truncated: false };
}
