import crypto from 'crypto';

import { getPool } from '@/services/MySQLService';
import { deliverPendingRuntimeIssueAlert } from '@/lib/runtimeIssueAlerts';

export type RuntimeIssueSeverity = 'warning' | 'error' | 'critical';

export interface RuntimeIssueReference {
  type: string;
  id: string | number;
}

export interface ReportRuntimeIssueInput {
  businessId?: string | null;
  source: string;
  operation: string;
  severity?: RuntimeIssueSeverity;
  title: string;
  error: unknown;
  context?: Record<string, unknown>;
  reference?: RuntimeIssueReference;
}

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token)/i;
const BEARER_VALUE = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const MAX_CONTEXT_LENGTH = 16_000;

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function normalizeMessage(message: string): string {
  return message
    .replace(BEARER_VALUE, 'Bearer [REDACTED]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeRuntimeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return truncate(value.replace(BEARER_VALUE, 'Bearer [REDACTED]'), 4_000);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeRuntimeValue(item, depth + 1));
  if (typeof value !== 'object') return String(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    sanitized[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeRuntimeValue(item, depth + 1);
  }
  return sanitized;
}

export function serializeRuntimeContext(context: Record<string, unknown> | undefined): string {
  const safeContext = sanitizeRuntimeValue(context ?? {});
  const serialized = JSON.stringify(safeContext);
  if (serialized.length <= MAX_CONTEXT_LENGTH) return serialized;
  return JSON.stringify({
    truncated: true,
    preview: serialized.slice(0, MAX_CONTEXT_LENGTH - 80),
  });
}

function normalizeError(error: unknown): { name: string; message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: truncate(error.message || String(error), 5_000),
      stack: error.stack ? truncate(error.stack.replace(BEARER_VALUE, 'Bearer [REDACTED]'), 16_000) : null,
    };
  }
  if (typeof error === 'string') return { name: 'Error', message: truncate(error, 5_000), stack: null };
  const sanitized = sanitizeRuntimeValue(error);
  return { name: 'Error', message: truncate(JSON.stringify(sanitized), 5_000), stack: null };
}

export function runtimeIssueFingerprint(input: ReportRuntimeIssueInput): string {
  const normalized = normalizeError(input.error);
  return crypto.createHash('sha256').update([
    input.businessId || '__system__',
    input.source.trim().toLowerCase(),
    input.operation.trim().toLowerCase(),
    normalized.name,
    normalizeMessage(normalized.message),
  ].join('|')).digest('hex');
}

export async function reportRuntimeIssue(input: ReportRuntimeIssueInput): Promise<number | null> {
  if (!input.source?.trim() || !input.operation?.trim() || !input.title?.trim()) return null;

  const normalized = normalizeError(input.error);
  const fingerprint = runtimeIssueFingerprint(input);
  const contextJson = serializeRuntimeContext(input.context);
  let pool;
  try {
    pool = getPool();
  } catch (error) {
    console.error('[runtime-issues] failed to initialize database pool:', error);
    return null;
  }
  const connection = await pool.getConnection().catch(error => {
    console.error('[runtime-issues] failed to acquire database connection:', error);
    return null;
  });
  if (!connection) return null;
  let released = false;

  try {
    await connection.beginTransaction();
    const [result]: any = await connection.execute(
      `INSERT INTO runtime_issues
         (business_id, source, operation, severity, status, title, message, fingerprint,
          first_seen_at, last_seen_at, occurrence_count, source_reference_type,
            source_reference_id, latest_context, alert_pending)
         VALUES (?, ?, ?, ?, 'new', ?, ?, ?, NOW(3), NOW(3), 1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
           alert_pending = IF(status = 'fixed' OR (severity != 'critical' AND VALUES(severity) = 'critical'), 1, alert_pending),
         severity = IF(VALUES(severity) = 'critical', 'critical', severity),
         fixed_at = IF(status = 'fixed', NULL, fixed_at),
         status = IF(status = 'fixed', 'new', status),
         title = VALUES(title),
         message = VALUES(message),
         last_seen_at = NOW(3),
         occurrence_count = occurrence_count + 1,
         source_reference_type = VALUES(source_reference_type),
         source_reference_id = VALUES(source_reference_id),
         latest_context = VALUES(latest_context)`,
      [
        input.businessId || null,
        input.source.trim().slice(0, 64),
        input.operation.trim().slice(0, 128),
        input.severity ?? 'error',
        input.title.trim().slice(0, 255),
        normalized.message,
        fingerprint,
        input.reference?.type?.slice(0, 64) ?? null,
        input.reference?.id != null ? String(input.reference.id).slice(0, 191) : null,
        contextJson,
        (input.severity ?? 'error') === 'critical' ? 1 : 0,
      ],
    );
    const issueId = Number(result.insertId);
    await connection.execute(
      `INSERT INTO runtime_issue_events
         (issue_id, event_type, severity, message, stack_trace, context)
       VALUES (?, 'occurred', ?, ?, ?, ?)`,
      [issueId, input.severity ?? 'error', normalized.message, normalized.stack, contextJson],
    );
    await connection.commit();
    connection.release();
    released = true;
    await deliverPendingRuntimeIssueAlert(issueId).catch(error => {
      console.error('[runtime-issues] post-commit alert delivery failed:', error);
    });
    return issueId;
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error('[runtime-issues] failed to persist issue:', error);
    return null;
  } finally {
    if (!released) connection.release();
  }
}