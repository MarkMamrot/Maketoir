import { createHash } from 'crypto';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { CS_BUSINESS_TOOL_NAMES } from './businessDataTools';
import { CsSettings, isCsAutomationMode, normalizeRunTimes } from './types';

function isMissingStarColumnError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('unknown column') && (message.includes('is_starred') || message.includes('starred_at'));
}

interface CsSettingsRow {
  enabled: number;
  timezone_override: string | null;
  run_times_json: string;
  automation_mode: string;
  lookback_days: number;
  retention_days: number;
  light_model_id: string;
  capable_model_id: string;
  enabled_tools_json: string;
  guidelines: string | null;
  helper_emails_json: string;
  learning_enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
}

function parseStringArray(value: string | null | undefined, fallback: string[] = []): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : fallback;
  } catch {
    return fallback;
  }
}

export async function getCustomerServiceSettings(businessId: string): Promise<CsSettings & {
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
}> {
  const rows = await imsQuery<CsSettingsRow>(
    'SELECT * FROM ims_cs_settings WHERE business_id = ? LIMIT 1',
    [businessId],
  );
  const timeZone = await getBusinessTimeZone(businessId);
  const row = rows[0];

  if (!row) {
    await imsExecute(
      `INSERT INTO ims_cs_settings
        (business_id, run_times_json, enabled_tools_json, helper_emails_json)
       VALUES (?, ?, ?, ?)`,
      [businessId, JSON.stringify(['10:00', '16:00']), JSON.stringify(CS_BUSINESS_TOOL_NAMES), '[]'],
    );
  }

  return {
    enabled: !!row?.enabled,
    timezone: row?.timezone_override || timeZone,
    runTimes: normalizeRunTimes(parseStringArray(row?.run_times_json, ['10:00', '16:00'])),
    mode: isCsAutomationMode(row?.automation_mode) ? row.automation_mode : 'draft',
    lookbackDays: Math.max(1, Math.min(90, Number(row?.lookback_days ?? 7))),
    retentionDays: 90,
    lightModelId: row?.light_model_id || 'gemini-2.5-flash',
    capableModelId: row?.capable_model_id || 'gemini-2.5-pro',
    enabledTools: parseStringArray(row?.enabled_tools_json, [...CS_BUSINESS_TOOL_NAMES])
      .filter(tool => CS_BUSINESS_TOOL_NAMES.includes(tool as any)),
    guidelines: row?.guidelines || '',
    helperEmails: parseStringArray(row?.helper_emails_json),
    learningEnabled: row ? !!row.learning_enabled : true,
    lastRunAt: row?.last_run_at ?? null,
    nextRunAt: row?.next_run_at ?? null,
    lastError: row?.last_error ?? null,
  };
}

export async function saveCustomerServiceSettings(businessId: string, input: Partial<CsSettings>): Promise<void> {
  const current = await getCustomerServiceSettings(businessId);
  const enabledTools = Array.isArray(input.enabledTools)
    ? input.enabledTools.filter(tool => CS_BUSINESS_TOOL_NAMES.includes(tool as any))
    : current.enabledTools;
  const helperEmails = Array.isArray(input.helperEmails)
    ? input.helperEmails.map(email => email.trim().toLowerCase()).filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)).slice(0, 10)
    : current.helperEmails;

  await imsExecute(
    `INSERT INTO ims_cs_settings
      (business_id, enabled, timezone_override, run_times_json, automation_mode,
       lookback_days, retention_days, light_model_id, capable_model_id,
       enabled_tools_json, guidelines, helper_emails_json, learning_enabled)
     VALUES (?, ?, ?, ?, ?, ?, 90, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled), timezone_override = VALUES(timezone_override),
       run_times_json = VALUES(run_times_json), automation_mode = VALUES(automation_mode),
       lookback_days = VALUES(lookback_days), retention_days = 90,
       light_model_id = VALUES(light_model_id), capable_model_id = VALUES(capable_model_id),
       enabled_tools_json = VALUES(enabled_tools_json), guidelines = VALUES(guidelines),
       helper_emails_json = VALUES(helper_emails_json), learning_enabled = VALUES(learning_enabled)`,
    [
      businessId,
      input.enabled ?? current.enabled ? 1 : 0,
      (input.timezone ?? current.timezone).slice(0, 100),
      JSON.stringify(normalizeRunTimes(input.runTimes ?? current.runTimes)),
      isCsAutomationMode(input.mode) ? input.mode : current.mode,
      Math.max(1, Math.min(90, Number(input.lookbackDays ?? current.lookbackDays))),
      String(input.lightModelId ?? current.lightModelId).slice(0, 150),
      String(input.capableModelId ?? current.capableModelId).slice(0, 150),
      JSON.stringify(enabledTools),
      String(input.guidelines ?? current.guidelines).slice(0, 20000),
      JSON.stringify(helperEmails),
      input.learningEnabled ?? current.learningEnabled ? 1 : 0,
    ],
  );
}

export async function ensureCustomerServiceKnowledgeDocuments(businessId: string): Promise<void> {
  for (const document of [
    { key: 'style', filename: 'customer-service-style.md', content: '# Customer Service Style\n' },
    { key: 'knowledge', filename: 'customer-service-knowledge.md', content: '# Customer Service Knowledge\n' },
  ] as const) {
    const hash = createHash('sha256').update(document.content).digest('hex');
    await imsExecute(
      `INSERT IGNORE INTO ims_cs_knowledge_documents
        (business_id, document_key, filename, markdown_content, version, content_hash)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [businessId, document.key, document.filename, document.content, hash],
    );
  }
}

export async function getCustomerServiceKnowledge(businessId: string): Promise<Array<{
  documentKey: 'style' | 'knowledge';
  filename: string;
  markdown: string;
  version: number;
  updatedAt: string;
}>> {
  await ensureCustomerServiceKnowledgeDocuments(businessId);
  const rows = await imsQuery<any>(
    `SELECT document_key, filename, markdown_content, version, updated_at
       FROM ims_cs_knowledge_documents WHERE business_id = ? ORDER BY document_key`,
    [businessId],
  );
  return rows.map(row => ({
    documentKey: row.document_key,
    filename: row.filename,
    markdown: row.markdown_content,
    version: Number(row.version),
    updatedAt: row.updated_at,
  }));
}

export async function saveCustomerServiceKnowledge(input: {
  businessId: string;
  documentKey: 'style' | 'knowledge';
  markdown: string;
  userId: number;
  reason?: string;
}): Promise<number> {
  const maxWords = input.documentKey === 'style' ? 800 : 1500;
  const words = input.markdown.trim().split(/\s+/).filter(Boolean);
  if (words.length > maxWords) throw new Error(`${input.documentKey} document exceeds the ${maxWords}-word limit`);

  const existing = await imsQuery<any>(
    'SELECT version, markdown_content, content_hash FROM ims_cs_knowledge_documents WHERE business_id = ? AND document_key = ? LIMIT 1',
    [input.businessId, input.documentKey],
  );
  const current = existing[0];
  const nextVersion = Number(current?.version ?? 0) + 1;
  const hash = createHash('sha256').update(input.markdown).digest('hex');
  if (current?.content_hash === hash) return Number(current.version);

  if (current) {
    await imsExecute(
      `INSERT IGNORE INTO ims_cs_knowledge_versions
        (business_id, document_key, version, markdown_content, content_hash, change_reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.businessId, input.documentKey, current.version, current.markdown_content, current.content_hash, input.reason ?? null, input.userId],
    );
  }
  const filename = input.documentKey === 'style' ? 'customer-service-style.md' : 'customer-service-knowledge.md';
  await imsExecute(
    `INSERT INTO ims_cs_knowledge_documents
      (business_id, document_key, filename, markdown_content, version, content_hash, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE markdown_content = VALUES(markdown_content), version = VALUES(version),
       content_hash = VALUES(content_hash), updated_by = VALUES(updated_by)`,
    [input.businessId, input.documentKey, filename, input.markdown, nextVersion, hash, input.userId],
  );
  return nextVersion;
}

export async function listCustomerServiceThreads(businessId: string, input: {
  page?: number;
  pageSize?: number;
  query?: string;
  category?: string;
  status?: string;
  unread?: boolean;
}): Promise<{ rows: any[]; total: number; page: number; pageSize: number }> {
  const requestedPage = Number(input.page);
  const requestedPageSize = Number(input.pageSize);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.trunc(requestedPage)) : 1;
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.max(10, Math.min(100, Math.trunc(requestedPageSize)))
    : 30;
  const offset = (page - 1) * pageSize;
  const conditions = ['t.business_id = ?'];
  const params: any[] = [businessId];
  if (input.query?.trim()) {
    conditions.push('(t.subject LIKE ? OR t.customer_email LIKE ? OR t.snippet LIKE ?)');
    const like = `%${input.query.trim().slice(0, 120)}%`;
    params.push(like, like, like);
  }
  if (['customer_enquiry', 'junk', 'other', 'unclassified'].includes(input.category || '')) {
    if (input.category === 'unclassified') conditions.push('t.category IS NULL');
    else { conditions.push('t.category = ?'); params.push(input.category); }
  }
  if (['open', 'needs_review', 'drafted', 'sent', 'archived', 'failed'].includes(input.status || '')) {
    conditions.push('t.workflow_status = ?');
    params.push(input.status);
  } else {
    conditions.push("COALESCE(t.workflow_status, 'open') <> 'archived'");
  }
  if (input.unread) conditions.push('t.unread_count > 0');

  const where = conditions.join(' AND ');
  const countRows = await imsQuery<{ total: number }>(`SELECT COUNT(*) AS total FROM ims_cs_threads t WHERE ${where}`, params);
  const baseSelect = `SELECT t.id, t.gmail_thread_id, t.customer_id, t.customer_email, t.subject, t.snippet,
            t.message_count, t.unread_count, t.category, t.enquiry_subtype,
            t.classification_confidence, t.urgency, t.sentiment, t.workflow_status,
            t.last_message_at, t.updated_at,
            d.id AS draft_id, d.status AS draft_status, d.version AS draft_version
       FROM ims_cs_threads t
       LEFT JOIN ims_cs_drafts d ON d.id = (
         SELECT d2.id FROM ims_cs_drafts d2
          WHERE d2.business_id = t.business_id AND d2.thread_id = t.id AND d2.status <> 'superseded'
          ORDER BY d2.id DESC LIMIT 1
       )
      WHERE ${where}`;

  let rows: any[] = [];
  try {
    rows = await imsQuery<any>(
      `SELECT t.id, t.gmail_thread_id, t.customer_id, t.customer_email, t.subject, t.snippet,
              t.message_count, t.unread_count, t.category, t.enquiry_subtype,
              t.classification_confidence, t.urgency, t.sentiment, t.workflow_status,
              t.is_starred, t.starred_at,
              t.last_message_at, t.updated_at,
              d.id AS draft_id, d.status AS draft_status, d.version AS draft_version
         FROM ims_cs_threads t
         LEFT JOIN ims_cs_drafts d ON d.id = (
           SELECT d2.id FROM ims_cs_drafts d2
            WHERE d2.business_id = t.business_id AND d2.thread_id = t.id AND d2.status <> 'superseded'
            ORDER BY d2.id DESC LIMIT 1
         )
        WHERE ${where}
        ORDER BY t.is_starred DESC, COALESCE(t.starred_at, t.last_message_at) DESC, t.last_message_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
  } catch (error) {
    if (!isMissingStarColumnError(error)) throw error;
    rows = await imsQuery<any>(
      `${baseSelect}
       ORDER BY t.last_message_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    rows = rows.map(row => ({ ...row, is_starred: 0, starred_at: null }));
  }
  return { rows, total: Number(countRows[0]?.total ?? 0), page, pageSize };
}

export async function getCustomerServiceThread(businessId: string, threadId: number): Promise<any | null> {
  const threads = await imsQuery<any>('SELECT * FROM ims_cs_threads WHERE business_id = ? AND id = ? LIMIT 1', [businessId, threadId]);
  if (!threads[0]) return null;
  const [messages, drafts, events] = await Promise.all([
    imsQuery<any>(
      `SELECT id, gmail_message_id, direction, from_address, to_json, cc_json, subject,
              body_plain, attachment_metadata_json, gmail_labels_json, is_read, is_draft, is_sent, message_at
         FROM ims_cs_messages WHERE business_id = ? AND thread_id = ? ORDER BY message_at, id`,
      [businessId, threadId],
    ),
    imsQuery<any>(
      `SELECT id, target_message_id, version, status, subject, ai_generated_body, current_body,
              gmail_draft_id, gmail_sent_message_id, model_id, confidence, needs_information,
              escalation_reason, tool_provenance_json, edited_at, sent_at, last_error, updated_at
         FROM ims_cs_drafts WHERE business_id = ? AND thread_id = ? AND status <> 'superseded'
         ORDER BY id DESC LIMIT 5`,
      [businessId, threadId],
    ),
    imsQuery<any>(
      `SELECT event_type, actor_type, details_json, created_at FROM ims_cs_events
        WHERE business_id = ? AND thread_id = ? ORDER BY created_at DESC LIMIT 30`,
      [businessId, threadId],
    ),
  ]);
  return { thread: threads[0], messages, drafts, events };
}

export async function updateCustomerServiceThread(businessId: string, threadId: number, input: {
  category?: string;
  status?: string;
  starred?: boolean | string;
  userId: number;
}): Promise<boolean> {
  const updates: string[] = [];
  const params: any[] = [];
  if (['customer_enquiry', 'junk', 'other'].includes(input.category || '')) {
    updates.push('category = ?'); params.push(input.category);
  }
  if (['open', 'needs_review', 'drafted', 'sent', 'archived', 'failed'].includes(input.status || '')) {
    updates.push('workflow_status = ?'); params.push(input.status);
  }
  if (typeof input.starred === 'boolean' || input.starred === 'true' || input.starred === 'false') {
    const starred = input.starred === true || input.starred === 'true';
    updates.push('is_starred = ?'); params.push(starred ? 1 : 0);
    updates.push('starred_at = ?'); params.push(starred ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null);
  }
  if (!updates.length) return false;
  params.push(businessId, threadId);
  let result;
  try {
    result = await imsExecute(`UPDATE ims_cs_threads SET ${updates.join(', ')} WHERE business_id = ? AND id = ?`, params);
  } catch (error) {
    if (isMissingStarColumnError(error) && (typeof input.starred === 'boolean' || input.starred === 'true' || input.starred === 'false')) {
      throw new Error('Star follow-up requires the latest customer-service schema migration.');
    }
    throw error;
  }
  if (!result.affectedRows) return false;
  await imsExecute(
    `INSERT INTO ims_cs_events (business_id, thread_id, event_type, actor_type, actor_id, details_json)
     VALUES (?, ?, 'thread_updated', 'user', ?, ?)`,
    [businessId, threadId, String(input.userId), JSON.stringify({ category: input.category, status: input.status, starred: input.starred })],
  );
  return true;
}

export async function updateCustomerServiceDraft(input: {
  businessId: string;
  draftId: number;
  expectedVersion: number;
  body: string;
  userId: number;
}): Promise<{ version: number }> {
  const current = await imsQuery<any>(
    `SELECT id, version, current_body, status FROM ims_cs_drafts
      WHERE business_id = ? AND id = ? AND status NOT IN ('sent','sending','superseded') LIMIT 1`,
    [input.businessId, input.draftId],
  );
  if (!current[0]) throw new Error('Draft not found or can no longer be edited');
  if (Number(current[0].version) !== input.expectedVersion) throw new Error('Draft changed elsewhere. Reload before saving.');
  const body = input.body.trim().slice(0, 50000);
  if (!body) throw new Error('Draft body cannot be empty');
  const nextVersion = input.expectedVersion + 1;
  const result = await imsExecute(
    `UPDATE ims_cs_drafts SET current_body = ?, version = ?, status = 'editing',
       editor_user_id = ?, edited_at = UTC_TIMESTAMP()
      WHERE business_id = ? AND id = ? AND version = ?`,
    [body, nextVersion, input.userId, input.businessId, input.draftId, input.expectedVersion],
  );
  if (!result.affectedRows) throw new Error('Draft changed elsewhere. Reload before saving.');
  await imsExecute(
    `INSERT INTO ims_cs_draft_revisions (business_id, draft_id, version, body, change_source, user_id)
     VALUES (?, ?, ?, ?, 'user', ?)`,
    [input.businessId, input.draftId, nextVersion, body, input.userId],
  );
  return { version: nextVersion };
}