import { createHash } from 'crypto';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { execute, getPool, query } from '@/services/MySQLService';
import { retryPendingProspectLeadAlerts } from './leadAlerts';

interface RetentionCandidate {
  id: string;
  metadata_json: unknown;
}

interface DemandInsight {
  fingerprint: string;
  demandType: 'integration' | 'feature' | 'workflow' | 'industry';
  requestedName: string;
  requestedProvider: string | null;
}

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return result || null;
}

export function demandInsightsFromMetadata(value: unknown): DemandInsight[] {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch {}
  const integration = clean(metadata.requestedIntegration, 255);
  const provider = clean(metadata.requestedProvider, 255);
  const unmetNeed = clean(metadata.unmetNeed, 255);
  const inputs: Array<Omit<DemandInsight, 'fingerprint'>> = [];
  if (integration || provider) inputs.push({ demandType: 'integration', requestedName: integration || 'Provider integration', requestedProvider: provider });
  if (unmetNeed) inputs.push({ demandType: 'feature', requestedName: unmetNeed, requestedProvider: null });
  return inputs.map(item => ({
    ...item,
    fingerprint: createHash('sha256').update(`${item.demandType}|${item.requestedName.toLowerCase()}|${item.requestedProvider?.toLowerCase() ?? ''}`).digest('hex'),
  }));
}

export async function maintainProspectConversations(input: { idleHours?: number; retentionMonths?: number } = {}) {
  const idleHours = Math.min(Math.max(Math.trunc(input.idleHours ?? 48), 1), 24 * 30);
  const retentionMonths = Math.min(Math.max(Math.trunc(input.retentionMonths ?? 12), 1), 120);
  const closed = await execute(
    `UPDATE prospect_conversations c
        SET c.status = 'abandoned', c.updated_at = UTC_TIMESTAMP(3)
      WHERE c.status = 'active' AND c.last_message_at < UTC_TIMESTAMP(3) - INTERVAL ? HOUR
        AND NOT EXISTS(SELECT 1 FROM prospect_leads l WHERE l.conversation_id = c.id)`,
    [idleHours],
  );
  const candidates = await query<RetentionCandidate>(
    `SELECT c.id, m.metadata_json
       FROM prospect_conversations c
       LEFT JOIN prospect_messages m ON m.id = (
         SELECT pm.id FROM prospect_messages pm
          WHERE pm.conversation_id = c.id AND pm.role = 'assistant'
          ORDER BY pm.created_at DESC, pm.id DESC LIMIT 1
       )
      WHERE c.created_at < UTC_TIMESTAMP(3) - INTERVAL ? MONTH
        AND (c.last_user_prompt IS NOT NULL OR EXISTS(
          SELECT 1 FROM prospect_messages old_message
           WHERE old_message.conversation_id = c.id AND old_message.content <> '[removed by retention]'))
      ORDER BY c.created_at LIMIT 500`,
    [retentionMonths],
  );
  const connection = await getPool().getConnection();
  let deidentified = 0;
  try {
    for (const candidate of candidates) {
      await connection.beginTransaction();
      try {
        for (const insight of demandInsightsFromMetadata(candidate.metadata_json)) {
          await connection.execute(
            `INSERT INTO prospect_demand_insights
              (fingerprint, demand_type, requested_name, requested_provider, sample_prompt,
               first_seen_at, last_seen_at, occurrence_count, conversation_count)
             VALUES (?, ?, ?, ?, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1, 1)
             ON DUPLICATE KEY UPDATE last_seen_at = UTC_TIMESTAMP(3),
               occurrence_count = occurrence_count + 1, conversation_count = conversation_count + 1`,
            [insight.fingerprint, insight.demandType, insight.requestedName, insight.requestedProvider],
          );
        }
        await connection.execute(
          `UPDATE prospect_messages SET content = '[removed by retention]', metadata_json = NULL
            WHERE conversation_id = ?`,
          [candidate.id],
        );
        await connection.execute(
          `UPDATE prospect_conversations
              SET status = 'closed', last_user_prompt = NULL, attribution_json = NULL,
                  session_id_hash = SHA2(CONCAT('retained:', id), 256), updated_at = UTC_TIMESTAMP(3)
            WHERE id = ?`,
          [candidate.id],
        );
        await connection.commit();
        deidentified += 1;
      } catch (error) {
        await connection.rollback().catch(() => null);
        throw error;
      }
    }
  } finally {
    connection.release();
  }
  const leadContacts = await execute(
    `UPDATE prospect_leads
        SET name = 'Retained consent record', company = NULL, email = NULL, phone = NULL,
            locations = NULL, current_systems = NULL, timeframe = NULL, source_path = NULL,
            updated_at = UTC_TIMESTAMP(3)
      WHERE created_at < UTC_TIMESTAMP(3) - INTERVAL ? MONTH
        AND (email IS NOT NULL OR phone IS NOT NULL OR company IS NOT NULL OR name <> 'Retained consent record')`,
    [retentionMonths],
  );
  const rateLimits = await execute('DELETE FROM prospect_rate_limits WHERE expires_at < UTC_TIMESTAMP(3)');
  const alerts = await retryPendingProspectLeadAlerts();
  return { abandoned: closed.affectedRows, deidentified, leadContactsDeidentified: leadContacts.affectedRows, rateLimitsDeleted: rateLimits.affectedRows, alerts };
}

export async function runProspectConversationMaintenance(input: { idleHours?: number; retentionMonths?: number } = {}) {
  try {
    return await maintainProspectConversations(input);
  } catch (error) {
    await reportRuntimeIssue({
      source: 'ProspectConversationMaintenance', operation: 'retention', severity: 'error',
      title: 'Prospect conversation maintenance failed', error,
      context: { idleHours: input.idleHours ?? 48, retentionMonths: input.retentionMonths ?? 12 },
    }).catch(() => null);
    throw error;
  }
}
