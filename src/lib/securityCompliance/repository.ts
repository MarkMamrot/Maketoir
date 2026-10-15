import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { execute, getPool, query } from '@/services/MySQLService';
import { createDefaultPolicyAssignments, validatePolicyAssignments, type PolicyAssignments, type PolicyAssignmentState } from './policies';

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
    })().catch(error => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
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
