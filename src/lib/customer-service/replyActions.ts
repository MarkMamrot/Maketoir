import { getGmailAccess, saveGmailReplyDraft, sendGmailReply } from './gmailClient';
import { recordDraftEditLearning } from './learning';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

interface ReplyRow {
  id: number;
  thread_id: number;
  version: number;
  status: string;
  subject: string;
  ai_generated_body: string;
  current_body: string;
  gmail_draft_id: string | null;
  gmail_thread_id: string;
  customer_email: string;
  message_id_header: string | null;
  references_header: string | null;
}

async function loadReply(businessId: string, draftId: number): Promise<ReplyRow> {
  const rows = await imsQuery<ReplyRow>(
    `SELECT d.id, d.thread_id, d.version, d.status, d.subject, d.ai_generated_body,
            d.current_body, d.gmail_draft_id, t.gmail_thread_id, t.customer_email,
            m.message_id_header, m.references_header
       FROM ims_cs_drafts d
       JOIN ims_cs_threads t ON t.id = d.thread_id AND t.business_id = d.business_id
       JOIN ims_cs_messages m ON m.id = d.target_message_id AND m.business_id = d.business_id
      WHERE d.business_id = ? AND d.id = ? LIMIT 1`,
    [businessId, draftId],
  );
  if (!rows[0]) throw new Error('Draft not found');
  if (!rows[0].customer_email) throw new Error('Customer recipient is missing');
  return rows[0];
}

export async function saveReplyToGmailDraft(businessId: string, draftId: number): Promise<{ gmailDraftId: string }> {
  const draft = await loadReply(businessId, draftId);
  if (draft.status === 'sent' || draft.status === 'sending') throw new Error('Sent drafts cannot be changed');
  const { accessToken } = await getGmailAccess(businessId);
  const result = await saveGmailReplyDraft(accessToken, {
    gmailDraftId: draft.gmail_draft_id,
    gmailThreadId: draft.gmail_thread_id,
    to: draft.customer_email,
    subject: draft.subject,
    body: draft.current_body,
    replyToMessageId: draft.message_id_header,
    references: draft.references_header,
  });
  await imsExecute(
    `UPDATE ims_cs_drafts SET gmail_draft_id = ?, status = 'gmail_draft', last_error = NULL
      WHERE business_id = ? AND id = ?`,
    [result.draftId, businessId, draftId],
  );
  return { gmailDraftId: result.draftId };
}

export async function sendCustomerServiceReply(businessId: string, draftId: number, userId?: number): Promise<{ alreadySent: boolean; messageId?: string }> {
  const draft = await loadReply(businessId, draftId);
  if (draft.status === 'sent') return { alreadySent: true };
  const claim = await imsExecute(
    `UPDATE ims_cs_drafts SET status = 'sending', last_error = NULL
      WHERE business_id = ? AND id = ? AND status NOT IN ('sending','sent','superseded')`,
    [businessId, draftId],
  );
  if (!claim.affectedRows) throw new Error('Reply is already being sent or is no longer active');

  try {
    const { accessToken } = await getGmailAccess(businessId);
    const sent = await sendGmailReply(accessToken, {
      gmailThreadId: draft.gmail_thread_id,
      to: draft.customer_email,
      subject: draft.subject,
      body: draft.current_body,
      replyToMessageId: draft.message_id_header,
      references: draft.references_header,
    });
    await imsExecute(
      `UPDATE ims_cs_drafts SET status = 'sent', gmail_sent_message_id = ?, sent_at = UTC_TIMESTAMP()
        WHERE business_id = ? AND id = ?`,
      [sent.messageId, businessId, draftId],
    );
    await imsExecute("UPDATE ims_cs_threads SET workflow_status = 'sent' WHERE business_id = ? AND id = ?", [businessId, draft.thread_id]);
    await imsExecute(
      `INSERT INTO ims_cs_events (business_id, thread_id, draft_id, event_type, actor_type, actor_id, details_json)
       VALUES (?, ?, ?, 'reply_sent', ?, ?, ?)`,
      [businessId, draft.thread_id, draftId, userId ? 'user' : 'system', userId ? String(userId) : null, JSON.stringify({ gmailMessageId: sent.messageId })],
    );
    await recordDraftEditLearning({ businessId, draftId, originalBody: draft.ai_generated_body, finalBody: draft.current_body });
    return { alreadySent: false, messageId: sent.messageId };
  } catch (error: any) {
    await imsExecute("UPDATE ims_cs_drafts SET status = 'failed', last_error = ? WHERE business_id = ? AND id = ?", [String(error.message || error).slice(0, 4000), businessId, draftId]);
    await imsExecute("UPDATE ims_cs_threads SET workflow_status = 'failed' WHERE business_id = ? AND id = ?", [businessId, draft.thread_id]);
    throw error;
  }
}