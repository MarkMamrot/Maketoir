import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createHash } from 'node:crypto';
import guards from '../../../scripts/platform-security-guards.json';
import { execute, getPool, query } from '@/services/MySQLService';
import { createDefaultPolicyAssignments, SECURITY_POLICIES, validatePolicyAssignments, type PolicyAssignments, type PolicyAssignmentState } from './policies';
import {
  nextPolicyReviewAt, nextSecurityLogReviewAt, validatePolicyEvidenceRequest, validateSecurityReviewPeriod, PolicyEvidenceValidationError,
  type AuthenticationReviewData, type PolicyEvidenceRecord, type PolicyEvidenceRequest, type PolicyEvidenceState,
} from './policyEvidence';

interface AssignmentRow extends RowDataPacket {
  assignments_json: unknown;
  revision: number;
  updated_at: Date | string | null;
  updated_by: number | null;
}

let schemaReady: Promise<void> | undefined;

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await execute(`CREATE TABLE IF NOT EXISTS security_policy_assignments (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
        assignments_json JSON NOT NULL,
        revision INT UNSIGNED NOT NULL DEFAULT 0,
        updated_by INT NULL,
        updated_at DATETIME(3) NULL
      ) ENGINE=InnoDB`);
      await execute(`CREATE TABLE IF NOT EXISTS security_policy_assignment_history (
        revision INT UNSIGNED NOT NULL PRIMARY KEY,
        assignments_json JSON NOT NULL,
        updated_by INT NOT NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB`);
      await execute(`CREATE TABLE IF NOT EXISTS security_policy_evidence (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        policy_id VARCHAR(64) NOT NULL,
        event_kind ENUM('log_review','adoption','policy_review') NOT NULL,
        policy_version VARCHAR(16) NOT NULL,
        policy_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        assignment_revision INT UNSIGNED NOT NULL,
        assignments_json JSON NOT NULL,
        actor_user_id INT NOT NULL,
        summary VARCHAR(1000) NOT NULL,
        evidence_reference VARCHAR(500) NOT NULL,
        review_from DATE NULL,
        review_through DATE NULL,
        operation_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        recorded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_policy_evidence_operation (operation_key),
        INDEX idx_policy_evidence_current (policy_id, policy_hash, event_kind, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const existing = await query<RowDataPacket>(
        "SELECT TRIGGER_NAME, ACTION_STATEMENT, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'security_policy_evidence'",
      );
      const normalize = (body: string) => body.replace(/\s+/g, ' ').trim();
      const matches = (row: RowDataPacket, guard: (typeof guards)[number]) => row.ACTION_TIMING === 'BEFORE'
        && row.EVENT_MANIPULATION === guard.event && row.EVENT_OBJECT_TABLE === guard.table
        && typeof row.ACTION_STATEMENT === 'string' && normalize(row.ACTION_STATEMENT) === normalize(guard.body);
      for (const guard of guards.filter(item => item.table === 'security_policy_evidence')) {
        const installed = existing.find(row => row.TRIGGER_NAME === guard.name);
        if (installed) {
          if (!matches(installed, guard)) throw new Error('Security evidence write guard differs; an administrator must review it.');
        } else {
          try {
            await getPool().query(`CREATE TRIGGER \`${guard.name}\` BEFORE ${guard.event} ON \`${guard.table}\` FOR EACH ROW ${guard.body}`);
          } catch (error) {
            if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ER_TRG_ALREADY_EXISTS') throw error;
            const concurrent = await query<RowDataPacket>(
              'SELECT ACTION_STATEMENT, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?', [guard.name],
            );
            if (!concurrent[0] || !matches(concurrent[0], guard)) throw error;
          }
        }
      }
    })().catch(error => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

interface EvidenceRow extends RowDataPacket {
  id: number;
  policy_id: string;
  event_kind: PolicyEvidenceRecord['kind'];
  policy_version: string;
  policy_hash: string;
  assignment_revision: number;
  actor_user_id: number;
  summary: string;
  evidence_reference: string;
  recorded_at: Date | string;
  operation_key: string;
  request_hash: string;
  review_from: Date | string | null;
  review_through: Date | string | null;
}

function policyHash(policyId: string): string {
  const policy = SECURITY_POLICIES.find(item => item.id === policyId);
  if (!policy) throw new Error('Unknown security policy.');
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex');
}

function mapEvidence(row: EvidenceRow): PolicyEvidenceRecord {
  if (!Number.isSafeInteger(row.id) || row.id <= 0 || !Number.isSafeInteger(row.actor_user_id) || row.actor_user_id <= 0
    || !Number.isSafeInteger(row.assignment_revision) || row.assignment_revision < 0
    || !['log_review', 'adoption', 'policy_review'].includes(row.event_kind)
    || !Number.isFinite(new Date(row.recorded_at).getTime())) throw new Error('Stored policy evidence is invalid.');
  return {
    id: row.id, policyId: row.policy_id, kind: row.event_kind, policyVersion: row.policy_version, policyHash: row.policy_hash,
    assignmentRevision: row.assignment_revision, actorUserId: row.actor_user_id, summary: row.summary,
    evidenceReference: row.evidence_reference, recordedAt: new Date(row.recorded_at).toISOString(),
    reviewFrom: row.review_from ? new Date(row.review_from).toISOString().slice(0, 10) : null,
    reviewThrough: row.review_through ? new Date(row.review_through).toISOString().slice(0, 10) : null,
  };
}

export class PolicyEvidenceConflictError extends Error {}

export async function getPolicyEvidence(): Promise<PolicyEvidenceState> {
  await ensureSchema();
  const hashes = SECURITY_POLICIES.map(policy => policyHash(policy.id));
  const [currentRows, historyRows, logRows] = await Promise.all([
    query<EvidenceRow>(
      `SELECT * FROM security_policy_evidence WHERE id IN (
           SELECT MAX(id) FROM security_policy_evidence
            WHERE policy_hash IN (${hashes.map(() => '?').join(',')})
            GROUP BY policy_id, event_kind
         )`, hashes,
    ),
    query<EvidenceRow>('SELECT * FROM security_policy_evidence ORDER BY id DESC LIMIT 100'),
    query<EvidenceRow>("SELECT * FROM security_policy_evidence WHERE event_kind = 'log_review' ORDER BY review_through DESC, recorded_at DESC, id DESC LIMIT 1"),
  ]);
  const current = currentRows.map(mapEvidence);
  const lastLogReviewAt = logRows[0] ? mapEvidence(logRows[0]).recordedAt : null;
  return {
    policies: SECURITY_POLICIES.map(policy => {
      const adoptedAt = current.find(row => row.policyId === policy.id && row.kind === 'adoption')?.recordedAt ?? null;
      const reviewedAt = current.find(row => row.policyId === policy.id && row.kind === 'policy_review')?.recordedAt ?? null;
      const last = reviewedAt && adoptedAt ? (reviewedAt > adoptedAt ? reviewedAt : adoptedAt) : reviewedAt ?? adoptedAt;
      return { id: policy.id, hash: policyHash(policy.id), adoptedAt, reviewedAt, nextReviewAt: last ? nextPolicyReviewAt(policy.id, last) : null };
    }),
    lastLogReviewAt, nextLogReviewAt: lastLogReviewAt ? nextSecurityLogReviewAt(lastLogReviewAt, logRows[0].review_through
      ? new Date(logRows[0].review_through).toISOString().slice(0, 10) : null) : null,
    history: historyRows.map(mapEvidence),
  };
}

export async function getAuthenticationReviewData(input: { from: string; through: string; beforeId?: number }): Promise<AuthenticationReviewData> {
  const period = validateSecurityReviewPeriod(input.from, input.through);
  if (Date.parse(period.through) - Date.parse(period.from) >= 366 * 86400000
    || (input.beforeId !== undefined && (!Number.isSafeInteger(input.beforeId) || input.beforeId <= 0))) {
    throw new PolicyEvidenceValidationError('Limit authentication history to a year and use a valid page reference.');
  }
  interface AuthRow extends RowDataPacket {
    id: number; user_id: number | null; actor_user_id: number | null; business_id: string | null;
    event_type: string; ip_address: string | null; city: string | null; region: string | null; country: string | null;
    user_agent: string | null; created_at: Date | string; matched_count: number;
  }
  const rows = await query<AuthRow>(
    `SELECT /*+ MAX_EXECUTION_TIME(10000) */ * FROM (
       SELECT id, user_id, actor_user_id, business_id, event_type, ip_address, city, region, country,
              user_agent, created_at, COUNT(*) OVER() AS matched_count
         FROM user_auth_events WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
     ) scoped WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT 251`,
    [period.from, period.through, input.beforeId ?? null, input.beforeId ?? null],
  );
  let totalCount = rows[0] ? Number(rows[0].matched_count) : 0;
  if (!rows.length && input.beforeId !== undefined) {
    const counts = await query<RowDataPacket>(
      `SELECT /*+ MAX_EXECUTION_TIME(10000) */ COUNT(*) AS matched_count
         FROM user_auth_events WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [period.from, period.through],
    );
    if (!counts[0]) throw new Error('Authentication log counts are unavailable.');
    totalCount = Number(counts[0].matched_count);
  }
  if (!Number.isSafeInteger(totalCount) || totalCount < rows.length) throw new Error('Authentication log counts are invalid.');
  return { totalCount, hasMore: rows.length > 250, entries: rows.slice(0, 250).map(row => {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || !Number.isFinite(new Date(row.created_at).getTime())) {
      throw new Error('Authentication log metadata is invalid.');
    }
    return { id: row.id, userId: row.user_id, actorUserId: row.actor_user_id, businessId: row.business_id,
      eventType: row.event_type, ipAddress: row.ip_address, location: [row.city, row.region, row.country].filter(Boolean).join(', '),
      userAgent: row.user_agent, recordedAt: new Date(row.created_at).toISOString() };
  }) };
}

export async function savePolicyEvidence(input: {
  request: PolicyEvidenceRequest; actorUserId: number;
}): Promise<PolicyEvidenceRecord> {
  const request = validatePolicyEvidenceRequest(input.request);
  if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0) throw new Error('Invalid policy evidence actor.');
  const hash = createHash('sha256').update(JSON.stringify({ request, actorUserId: input.actorUserId })).digest('hex');
  await ensureSchema();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      'INSERT IGNORE INTO security_policy_assignments (id, assignments_json, revision) VALUES (1, ?, 0)',
      [JSON.stringify(createDefaultPolicyAssignments())],
    );
    const [assignments] = await connection.execute<AssignmentRow[]>(
      'SELECT assignments_json, revision, updated_by, updated_at FROM security_policy_assignments WHERE id = 1 FOR UPDATE',
    );
    if (!assignments[0]) throw new Error('Policy responsibilities could not be locked.');
    const state = mapRow(assignments[0]);
    const [existing] = await connection.execute<EvidenceRow[]>(
      'SELECT * FROM security_policy_evidence WHERE operation_key = ? FOR UPDATE', [request.operationKey],
    );
    if (existing[0]) {
      if (existing[0].request_hash !== hash || existing[0].actor_user_id !== input.actorUserId) {
        throw new PolicyEvidenceConflictError('This request key belongs to different evidence.');
      }
      await connection.commit();
      return mapEvidence(existing[0]);
    }
    if (state.revision !== request.expectedRevision || policyHash(request.policyId) !== request.policyHash) {
      throw new PolicyEvidenceConflictError('The policy or responsibilities changed. Reload before recording evidence.');
    }
    if (request.kind === 'policy_review') {
      const [adoption] = await connection.execute<EvidenceRow[]>(
        "SELECT * FROM security_policy_evidence WHERE policy_id = ? AND policy_hash = ? AND event_kind = 'adoption' LIMIT 1 FOR UPDATE",
        [request.policyId, request.policyHash],
      );
      if (!adoption[0]) throw new PolicyEvidenceConflictError('Adopt the current policy before recording its periodic review.');
    }
    const policy = SECURITY_POLICIES.find(item => item.id === request.policyId)!;
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO security_policy_evidence
          (policy_id, event_kind, policy_version, policy_hash, assignment_revision, assignments_json, actor_user_id,
           summary, evidence_reference, operation_key, request_hash, review_from, review_through)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.policyId, request.kind, policy.version, request.policyHash, state.revision, JSON.stringify(state.assignments),
        input.actorUserId, request.summary, request.evidenceReference, request.operationKey, hash, request.reviewFrom, request.reviewThrough],
    );
    const [saved] = await connection.execute<EvidenceRow[]>('SELECT * FROM security_policy_evidence WHERE id = ?', [result.insertId]);
    if (!saved[0]) throw new Error('Saved policy evidence could not be verified.');
    const record = mapEvidence(saved[0]);
    await connection.commit();
    return record;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function mapRow(row: AssignmentRow): PolicyAssignmentState {
  let assignments: PolicyAssignments;
  try {
    assignments = validatePolicyAssignments(typeof row.assignments_json === 'string'
      ? JSON.parse(row.assignments_json)
      : row.assignments_json);
  } catch {
    throw new Error('Stored security policy responsibilities are invalid; repair the record before saving.');
  }
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0
    || !(row.updated_by === null || (Number.isSafeInteger(row.updated_by) && row.updated_by > 0))) {
    throw new Error('Stored security policy responsibility metadata is invalid; repair the record before saving.');
  }
  return {
    assignments,
    revision,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export class PolicyAssignmentConflictError extends Error {
  constructor() { super('Responsibilities changed in another session. Reload saved values before saving again.'); }
}

export async function getPolicyAssignments(): Promise<PolicyAssignmentState> {
  await ensureSchema();
  const rows = await query<AssignmentRow>(
    'SELECT assignments_json, revision, updated_by, updated_at FROM security_policy_assignments WHERE id = 1',
  );
  return rows[0] ? mapRow(rows[0]) : {
    assignments: createDefaultPolicyAssignments(), revision: 0, updatedBy: null, updatedAt: null,
  };
}

export async function savePolicyAssignments(input: {
  assignments: PolicyAssignments; expectedRevision: number; actorUserId: number;
}): Promise<PolicyAssignmentState> {
  const assignments = validatePolicyAssignments(input.assignments);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('Invalid policy assignment revision.');
  }
  if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0) {
    throw new Error('Invalid policy assignment actor.');
  }
  await ensureSchema();
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT IGNORE INTO security_policy_assignments (id, assignments_json, revision)
       VALUES (1, ?, 0)`,
      [JSON.stringify(createDefaultPolicyAssignments())],
    );
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE security_policy_assignments
          SET assignments_json = ?, revision = revision + 1, updated_by = ?, updated_at = NOW(3)
        WHERE id = 1 AND revision = ?`,
      [JSON.stringify(assignments), input.actorUserId, input.expectedRevision],
    );
    if (result.affectedRows !== 1) throw new PolicyAssignmentConflictError();
    const [rows] = await connection.execute<AssignmentRow[]>(
      'SELECT assignments_json, revision, updated_by, updated_at FROM security_policy_assignments WHERE id = 1',
    );
    if (!rows[0]) throw new Error('Saved policy responsibilities could not be read back.');
    const state = mapRow(rows[0]);
    await connection.execute(
      `INSERT INTO security_policy_assignment_history (revision, assignments_json, updated_by, updated_at)
       VALUES (?, ?, ?, NOW(3))`,
      [state.revision, JSON.stringify(state.assignments), input.actorUserId],
    );
    await connection.commit();
    return state;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
