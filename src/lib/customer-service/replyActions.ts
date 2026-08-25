import {
  getGmailAccess,
  isDefinitiveGmailSendFailure,
  saveGmailReplyDraft,
  sendExistingGmailDraft,
} from './gmailClient';
import { recordDraftEditLearning } from './learning';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsExecute, imsQuery } from '@/services/IMSMySQLService';

interface ReplyRow {
  id: number;
  thread_id: number;
  version: number;
  status: string;
  subject: string;
  ai_generated_body: string;
  current_body: string;
  operation_key: string;
  compose_type: 'ai_reply' | 'manual_reply' | 'forward';
  recipient_email: string | null;
  gmail_draft_id: string | null;
  gmail_thread_id: string;
  customer_email: string;
  message_id_header: string | null;
  references_header: string | null;
}

async function loadReply(businessId: string, draftId: number): Promise<ReplyRow> {
  const rows = await imsQuery<ReplyRow>(
        `SELECT d.id, d.thread_id, d.version, d.status, d.subject, d.ai_generated_body,
          d.current_body, d.operation_key, d.compose_type, d.recipient_email, d.gmail_draft_id,
          t.gmail_thread_id, t.customer_email,
            m.message_id_header, m.references_header
       FROM ims_cs_drafts d
       JOIN ims_cs_threads t ON t.id = d.thread_id AND t.business_id = d.business_id
       JOIN ims_cs_messages m ON m.id = d.target_message_id AND m.business_id = d.business_id
      WHERE d.business_id = ? AND d.id = ? LIMIT 1`,
    [businessId, draftId],
  );
  if (!rows[0]) throw new Error('Draft not found');
  if (!(rows[0].recipient_email || rows[0].customer_email)) throw new Error('Recipient is missing');
  return rows[0];
}

export async function saveReplyToGmailDraft(businessId: string, draftId: number): Promise<{ gmailDraftId: string }> {
  const draft = await loadReply(businessId, draftId);
  if (draft.status === 'sent' || draft.status === 'sending') throw new Error('Sent drafts cannot be changed');
  const { accessToken } = await getGmailAccess(businessId);
  const result = await saveGmailReplyDraft(accessToken, {
    gmailDraftId: draft.gmail_draft_id,
    gmailThreadId: draft.compose_type === 'forward' ? null : draft.gmail_thread_id,
    to: draft.recipient_email || draft.customer_email,
    subject: draft.subject,
    body: draft.current_body,
    replyToMessageId: draft.compose_type === 'forward' ? null : draft.message_id_header,
    references: draft.compose_type === 'forward' ? null : draft.references_header,
  });
  await imsExecute(
    `UPDATE ims_cs_drafts SET gmail_draft_id = ?, status = 'gmail_draft', last_error = NULL
      WHERE business_id = ? AND id = ?`,
    [result.draftId, businessId, draftId],
  );
  return { gmailDraftId: result.draftId };
}

export async function sendCustomerServiceReply(businessId: string, draftId: number, userId?: number): Promise<{
  alreadySent: boolean;
  messageId?: string;
  status: 'sent' | 'confirming';
}> {
  const draft = await loadReply(businessId, draftId);
  if (draft.status === 'sent') return { alreadySent: true, messageId: undefined, status: 'sent' };
  const claim = await imsExecute(
    `UPDATE ims_cs_drafts SET status = 'sending', last_error = NULL
      WHERE business_id = ? AND id = ? AND status NOT IN ('sending','sent','superseded')`,
    [businessId, draftId],
  );
  if (!claim.affectedRows) throw new Error('Reply is already being sent or is no longer active');

  let providerDraftId: string | null = null;
  let providerMessageId: string | null = null;
  try {
    const { accessToken, mailboxEmail } = await getGmailAccess(businessId);
    const stableMessageId = `<cs-${draft.operation_key}@solvantis.local>`;
    const providerDraft = await saveGmailReplyDraft(accessToken, {
      gmailDraftId: draft.gmail_draft_id,
      gmailThreadId: draft.compose_type === 'forward' ? null : draft.gmail_thread_id,
      to: draft.recipient_email || draft.customer_email,
      subject: draft.subject,
      body: draft.current_body,
      replyToMessageId: draft.compose_type === 'forward' ? null : draft.message_id_header,
      references: draft.compose_type === 'forward' ? null : draft.references_header,
      messageIdHeader: stableMessageId,
    });
    providerDraftId = providerDraft.draftId;
    await imsExecute(
      `UPDATE ims_cs_drafts SET gmail_draft_id = ? WHERE business_id = ? AND id = ? AND status = 'sending'`,
      [providerDraftId, businessId, draftId],
    );
    const sent = await sendExistingGmailDraft(accessToken, providerDraftId);
    providerMessageId = sent.messageId;
    const providerThreadId = sent.threadId || draft.gmail_thread_id;

    const connection = await getIMSPool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE ims_cs_drafts SET status = 'sent', gmail_sent_message_id = ?, sent_at = UTC_TIMESTAMP(), last_error = NULL
          WHERE business_id = ? AND id = ? AND status = 'sending'`,
        [providerMessageId, businessId, draftId],
      );
      await connection.execute(
        `INSERT INTO ims_cs_messages
          (business_id, thread_id, gmail_message_id, gmail_thread_id, direction, from_address,
           to_json, cc_json, subject, message_id_header, references_header, body_plain,
           body_html, attachment_metadata_json, gmail_labels_json, is_read, is_draft, is_sent, message_at)
         VALUES (?, ?, ?, ?, 'outbound', ?, ?, '[]', ?, ?, ?, ?, NULL, '[]', '["SENT"]', 1, 0, 1, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE direction = 'outbound', is_draft = 0, is_sent = 1,
           gmail_labels_json = '["SENT"]', body_plain = VALUES(body_plain), updated_at = CURRENT_TIMESTAMP`,
        [businessId, draft.thread_id, providerMessageId, providerThreadId, mailboxEmail,
          JSON.stringify([draft.recipient_email || draft.customer_email]), draft.subject, stableMessageId,
          draft.compose_type === 'forward' ? null : draft.references_header, draft.current_body],
      );
      await connection.execute(
        `UPDATE ims_cs_threads SET workflow_status = 'sent', latest_message_id = ?,
           snippet = ?, message_count = (
             SELECT COUNT(*) FROM ims_cs_messages m WHERE m.business_id = ? AND m.thread_id = ?
           ), last_message_at = UTC_TIMESTAMP(), last_gmail_sync_at = UTC_TIMESTAMP()
          WHERE business_id = ? AND id = ?`,
        [providerMessageId, draft.current_body.slice(0, 1000), businessId, draft.thread_id, businessId, draft.thread_id],
      );
      await connection.execute(
        `INSERT INTO ims_cs_events (business_id, thread_id, draft_id, event_type, actor_type, actor_id, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [businessId, draft.thread_id, draftId, draft.compose_type === 'forward' ? 'message_forwarded' : 'reply_sent',
          userId ? 'user' : 'system', userId ? String(userId) : null,
          JSON.stringify({ gmailMessageId: providerMessageId })],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    if (draft.compose_type === 'ai_reply') {
      try {
        await recordDraftEditLearning({ businessId, draftId, originalBody: draft.ai_generated_body, finalBody: draft.current_body });
      } catch (error) {
        await reportRuntimeIssue({
          businessId,
          source: 'CustomerServiceReply',
          operation: 'record_reply_learning',
          severity: 'warning',
          title: 'Sent customer reply learning could not be recorded',
          error,
          reference: { type: 'customer_service_draft', id: draftId },
        });
      }
    }
    return { alreadySent: false, messageId: providerMessageId, status: 'sent' };
  } catch (error: any) {
    const definitiveFailure = !providerDraftId || (!providerMessageId && isDefinitiveGmailSendFailure(error));
    if (definitiveFailure) {
      await imsExecute(
        "UPDATE ims_cs_drafts SET status = 'failed', last_error = ? WHERE business_id = ? AND id = ? AND status = 'sending'",
        [String(error.message || error).slice(0, 4000), businessId, draftId],
      );
      await imsExecute("UPDATE ims_cs_threads SET workflow_status = 'failed' WHERE business_id = ? AND id = ?", [businessId, draft.thread_id]);
    } else {
      await imsExecute(
        "UPDATE ims_cs_drafts SET last_error = ? WHERE business_id = ? AND id = ? AND status = 'sending'",
        ['Delivery confirmation is pending. Do not resend this reply.', businessId, draftId],
      ).catch(() => {});
    }
    await reportRuntimeIssue({
      businessId,
      source: 'CustomerServiceReply',
      operation: definitiveFailure ? 'send_reply_rejected' : 'confirm_reply_delivery',
      severity: definitiveFailure ? 'warning' : 'error',
      title: definitiveFailure ? 'Customer reply was rejected before sending' : 'Customer reply delivery needs confirmation',
      error,
      context: { draftId, threadId: draft.thread_id, providerDraftCreated: !!providerDraftId, providerAccepted: !!providerMessageId },
      reference: { type: 'customer_service_draft', id: draftId },
    });
    if (!definitiveFailure) return { alreadySent: false, messageId: providerMessageId || undefined, status: 'confirming' };
    throw error;
  }
}