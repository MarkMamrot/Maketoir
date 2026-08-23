import { getPool } from '@/services/MySQLService';
import { serializeRuntimeContext } from '@/lib/runtimeIssues';

import {
  addBusinessDays,
  createAssistantPublicReference,
  normalizeWorkflowFindingEvidence,
  workflowFindingFingerprint,
  type AssistantAudience,
  type WorkflowFindingEvidence,
} from './policy';

export type WorkflowFindingImpact = 'low' | 'medium' | 'high' | 'critical';

interface ConnectionLike {
  beginTransaction(): Promise<void>;
  execute(sql: string, values?: unknown[]): Promise<any>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface AssistantFindingDependencies {
  getConnection(): Promise<ConnectionLike>;
  now(): Date;
  createPublicReference(): string;
}

const defaultDependencies: AssistantFindingDependencies = {
  getConnection: () => getPool().getConnection() as unknown as Promise<ConnectionLike>,
  now: () => new Date(),
  createPublicReference: createAssistantPublicReference,
};

export interface ReportWorkflowFindingInput {
  businessId: string;
  evidence: WorkflowFindingEvidence;
  impact: WorkflowFindingImpact;
  confidence?: number;
  modelVersion?: string | null;
  promptVersion?: string | null;
  indexVersion?: string | null;
  toolManifestVersion?: string | null;
}

export async function reportWorkflowFinding(
  input: ReportWorkflowFindingInput,
  dependencies: AssistantFindingDependencies = defaultDependencies,
): Promise<number> {
  const evidence = normalizeWorkflowFindingEvidence(input.evidence);
  const fingerprint = workflowFindingFingerprint(evidence);
  const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0)));
  const connection = await dependencies.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO assistant_workflow_findings
         (fingerprint, category, impact, confidence, status, capability, audiences_json,
          title, evidence_json, first_seen_at, last_seen_at, occurrence_count,
          affected_business_count, model_version, prompt_version, index_version,
          tool_manifest_version, alert_pending)
       VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, NOW(3), NOW(3), 1, 1, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         impact = IF(FIELD(VALUES(impact), 'low','medium','high','critical') > FIELD(impact, 'low','medium','high','critical'), VALUES(impact), impact),
         confidence = GREATEST(confidence, VALUES(confidence)),
         last_seen_at = NOW(3), occurrence_count = occurrence_count + 1,
         evidence_json = VALUES(evidence_json),
         alert_pending = IF(last_alerted_at IS NULL, 1, alert_pending)`,
      [
        fingerprint,
        evidence.category,
        input.impact,
        confidence,
        evidence.capability,
        JSON.stringify([evidence.audience]),
        evidence.goal.slice(0, 255),
        serializeRuntimeContext(evidence as unknown as Record<string, unknown>),
        input.modelVersion?.slice(0, 100) ?? null,
        input.promptVersion?.slice(0, 100) ?? null,
        input.indexVersion?.slice(0, 100) ?? null,
        input.toolManifestVersion?.slice(0, 100) ?? null,
      ],
    );
    const findingId = Number(result.insertId);
    await connection.execute(
      `INSERT IGNORE INTO assistant_workflow_finding_businesses (finding_id, business_id, first_seen_at, last_seen_at)
       VALUES (?, ?, NOW(3), NOW(3))`,
      [findingId, input.businessId],
    );
    await connection.execute(
      `UPDATE assistant_workflow_finding_businesses SET last_seen_at = NOW(3)
        WHERE finding_id = ? AND business_id = ?`,
      [findingId, input.businessId],
    );
    await connection.execute(
      `UPDATE assistant_workflow_findings
          SET affected_business_count = (SELECT COUNT(*) FROM assistant_workflow_finding_businesses WHERE finding_id = ?)
        WHERE id = ?`,
      [findingId, findingId],
    );
    await connection.execute(
      `INSERT INTO assistant_workflow_finding_events
         (finding_id, event_type, business_id, message, evidence_json)
       VALUES (?, 'observed', ?, ?, ?)`,
      [findingId, input.businessId, 'Qualified workflow blocker observed', serializeRuntimeContext(evidence as unknown as Record<string, unknown>)],
    );
    await connection.commit();
    return findingId;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

export interface CreateAssistantEscalationInput {
  parentKind: 'runtime_issue' | 'workflow_finding';
  parentId: number;
  businessId: string;
  audience: AssistantAudience;
  actorType: 'ims_user' | 'pos_user' | 'wholesale_member';
  actorId: string | number;
  canFollowUpDirectly: boolean;
  sourceReference?: { type: string; id: string | number } | null;
  currentView?: string | null;
  idempotencyKey: string;
}

export interface AssistantEscalationRecord {
  id: number;
  publicReference: string;
  responseDueAt: Date;
}

export async function createAssistantEscalation(
  input: CreateAssistantEscalationInput,
  dependencies: AssistantFindingDependencies = defaultDependencies,
): Promise<AssistantEscalationRecord> {
  const publicReference = dependencies.createPublicReference();
  const responseDueAt = addBusinessDays(dependencies.now(), 3);
  const connection = await dependencies.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO assistant_escalations
         (public_reference, idempotency_key, parent_kind, runtime_issue_id, workflow_finding_id,
          business_id, audience, actor_type, actor_id, can_follow_up_directly,
          source_reference_type, source_reference_id, current_view, status, response_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        publicReference,
        input.idempotencyKey.slice(0, 64),
        input.parentKind,
        input.parentKind === 'runtime_issue' ? input.parentId : null,
        input.parentKind === 'workflow_finding' ? input.parentId : null,
        input.businessId,
        input.audience,
        input.actorType,
        String(input.actorId).slice(0, 191),
        input.canFollowUpDirectly ? 1 : 0,
        input.sourceReference?.type.slice(0, 64) ?? null,
        input.sourceReference?.id != null ? String(input.sourceReference.id).slice(0, 191) : null,
        input.currentView?.slice(0, 100) ?? null,
        responseDueAt,
      ],
    );
    const escalationId = Number(result.insertId);
    const [rows] = await connection.execute(
      `SELECT public_reference, response_due_at FROM assistant_escalations WHERE id = ? LIMIT 1`,
      [escalationId],
    );
    const persisted = rows[0]?.[0];
    if (!persisted) throw new Error('Assistant escalation could not be reloaded after persistence.');
    await connection.execute(
      `INSERT INTO assistant_escalation_events (escalation_id, event_type, message)
       VALUES (?, 'opened', 'Assistant request escalated for follow-up')`,
      [escalationId],
    );
    await connection.commit();
    return {
      id: escalationId,
      publicReference: String(persisted.public_reference),
      responseDueAt: new Date(persisted.response_due_at),
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}