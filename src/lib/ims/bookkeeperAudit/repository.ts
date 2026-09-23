import type { ResultSetHeader } from 'mysql2/promise';
import { getPool, query } from '@/services/MySQLService';

export interface AuditReview {
  id: number;
  findingKey: string;
  fingerprint: string;
  reason: string;
  actorId: string | null;
  actorName: string | null;
  acceptedAt: string;
}

type TransactionExecutor = {
  execute(sql: string, params?: unknown[]): Promise<ResultSetHeader>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
};

type Dependencies = {
  query: typeof query;
  transaction<T>(callback: (executor: TransactionExecutor) => Promise<T>): Promise<T>;
};

async function defaultTransaction<T>(callback: (executor: TransactionExecutor) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const executor: TransactionExecutor = {
      execute: async (sql, params) => {
        const [result] = await connection.execute(sql, params);
        return result as ResultSetHeader;
      },
      query: async <Row>(sql: string, params?: unknown[]) => {
        const [rows] = await connection.execute(sql, params);
        return rows as Row[];
      },
    };
    const result = await callback(executor);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const defaultDependencies: Dependencies = { query, transaction: defaultTransaction };

export async function listAcceptedAuditReviews(
  businessId: string,
  dependencies: Dependencies = defaultDependencies,
): Promise<AuditReview[]> {
  const rows = await dependencies.query<{
    id: number;
    finding_key: string;
    fingerprint: string;
    reason: string;
    actor_id: string | null;
    actor_name: string | null;
    accepted_at: string;
  }>(
    `SELECT id, finding_key, fingerprint, reason, actor_id, actor_name, accepted_at
       FROM bookkeeper_audit_reviews
      WHERE business_id = ? AND status = 'accepted'
      ORDER BY accepted_at DESC, id DESC`,
    [businessId],
  );
  return rows.map(row => ({
    id: Number(row.id),
    findingKey: row.finding_key,
    fingerprint: row.fingerprint,
    reason: row.reason,
    actorId: row.actor_id,
    actorName: row.actor_name,
    acceptedAt: row.accepted_at,
  }));
}

export async function acceptAuditFinding(input: {
  businessId: string;
  findingKey: string;
  fingerprint: string;
  reason: string;
  actorId?: string | number | null;
  actorName?: string | null;
}, dependencies: Dependencies = defaultDependencies): Promise<number> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('A reason is required to accept an audit exception.');
  if (!/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new Error('A valid audit fingerprint is required.');

  return dependencies.transaction(async executor => {
    await executor.execute(
      `INSERT INTO bookkeeper_audit_reviews
         (business_id, finding_key, fingerprint, status, reason, actor_id, actor_name, accepted_at, revoked_at)
       VALUES (?, ?, ?, 'accepted', ?, ?, ?, NOW(3), NULL)
       ON DUPLICATE KEY UPDATE status = 'accepted', reason = VALUES(reason), actor_id = VALUES(actor_id),
         actor_name = VALUES(actor_name), accepted_at = NOW(3), revoked_at = NULL, updated_at = NOW(3)`,
      [
        input.businessId, input.findingKey, input.fingerprint, reason,
        input.actorId == null ? null : String(input.actorId), input.actorName ?? null,
      ],
    );
    const rows = await executor.query<{ id: number }>(
      `SELECT id FROM bookkeeper_audit_reviews
        WHERE business_id = ? AND finding_key = ? AND fingerprint = ? LIMIT 1`,
      [input.businessId, input.findingKey, input.fingerprint],
    );
    if (!rows[0]) throw new Error('Audit review could not be loaded.');
    await executor.execute(
      `INSERT INTO bookkeeper_audit_review_events
         (business_id, review_id, event_type, actor_id, actor_name, reason, fingerprint)
       VALUES (?, ?, 'accepted', ?, ?, ?, ?)`,
      [
        input.businessId, rows[0].id, input.actorId == null ? null : String(input.actorId),
        input.actorName ?? null, reason, input.fingerprint,
      ],
    );
    return Number(rows[0].id);
  });
}

export async function undoAuditFindingAcceptance(input: {
  businessId: string;
  findingKey: string;
  fingerprint: string;
  actorId?: string | number | null;
  actorName?: string | null;
}, dependencies: Dependencies = defaultDependencies): Promise<boolean> {
  return dependencies.transaction(async executor => {
    const rows = await executor.query<{ id: number }>(
      `SELECT id FROM bookkeeper_audit_reviews
        WHERE business_id = ? AND finding_key = ? AND fingerprint = ? AND status = 'accepted' LIMIT 1`,
      [input.businessId, input.findingKey, input.fingerprint],
    );
    if (!rows[0]) return false;
    const result = await executor.execute(
      `UPDATE bookkeeper_audit_reviews
          SET status = 'revoked', revoked_at = NOW(3), updated_at = NOW(3)
        WHERE business_id = ? AND id = ? AND status = 'accepted'`,
      [input.businessId, rows[0].id],
    );
    if (result.affectedRows === 0) return false;
    await executor.execute(
      `INSERT INTO bookkeeper_audit_review_events
         (business_id, review_id, event_type, actor_id, actor_name, fingerprint)
       VALUES (?, ?, 'revoked', ?, ?, ?)`,
      [
        input.businessId, rows[0].id, input.actorId == null ? null : String(input.actorId),
        input.actorName ?? null, input.fingerprint,
      ],
    );
    return true;
  });
}