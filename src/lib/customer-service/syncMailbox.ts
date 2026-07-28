import { getIMSPool } from '@/services/IMSMySQLService';
import { fetchRecentGmailThreads, getGmailAccess, NormalizedGmailThread } from './gmailClient';
import { getCustomerServiceSettings } from './repository';

function extractEmail(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim().toLowerCase();
}

async function upsertThread(businessId: string, mailboxEmail: string, thread: NormalizedGmailThread): Promise<number> {
  if (!thread.messages.length) return 0;
  const pool = getIMSPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const latest = thread.messages[thread.messages.length - 1];
    const inbound = [...thread.messages].reverse().find(message => extractEmail(message.from) !== mailboxEmail);
    const labels = Array.from(new Set(thread.messages.flatMap(message => message.labels)));
    const unreadCount = thread.messages.filter(message => message.labels.includes('UNREAD')).length;
    const participants = Array.from(new Set(thread.messages.flatMap(message => [message.from, ...message.to, ...message.cc]).filter(Boolean)));

    const [contacts] = await connection.query<any[]>(
      'SELECT id FROM ims_contacts WHERE business_id = ? AND LOWER(email) = ? LIMIT 1',
      [businessId, inbound ? extractEmail(inbound.from) : ''],
    );
    await connection.query(
      `INSERT INTO ims_cs_threads
        (business_id, gmail_thread_id, latest_message_id, customer_id, customer_email,
         subject, snippet, participants_json, gmail_labels_json, message_count, unread_count,
         last_message_at, last_gmail_sync_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE latest_message_id = VALUES(latest_message_id),
         customer_id = COALESCE(VALUES(customer_id), customer_id), customer_email = VALUES(customer_email),
         subject = VALUES(subject), snippet = VALUES(snippet), participants_json = VALUES(participants_json),
         gmail_labels_json = VALUES(gmail_labels_json), message_count = VALUES(message_count),
         unread_count = VALUES(unread_count), last_message_at = VALUES(last_message_at),
         last_gmail_sync_at = UTC_TIMESTAMP()`,
      [businessId, thread.gmailThreadId, latest.gmailMessageId, contacts[0]?.id ?? null,
        inbound ? extractEmail(inbound.from) : null, latest.subject, thread.snippet,
        JSON.stringify(participants), JSON.stringify(labels), thread.messages.length, unreadCount, latest.messageAt],
    );
    const [threadRows] = await connection.query<any[]>(
      'SELECT id FROM ims_cs_threads WHERE business_id = ? AND gmail_thread_id = ? LIMIT 1',
      [businessId, thread.gmailThreadId],
    );
    const threadId = Number(threadRows[0].id);

    for (const message of thread.messages) {
      const fromEmail = extractEmail(message.from);
      const direction = fromEmail === mailboxEmail ? (message.labels.includes('DRAFT') ? 'draft' : 'outbound') : 'inbound';
      await connection.query(
        `INSERT INTO ims_cs_messages
          (business_id, thread_id, gmail_message_id, gmail_thread_id, direction, from_address,
           to_json, cc_json, subject, message_id_header, references_header, body_plain,
           body_html, attachment_metadata_json, gmail_labels_json, is_read, is_draft, is_sent, message_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE thread_id = VALUES(thread_id), direction = VALUES(direction),
           from_address = VALUES(from_address), to_json = VALUES(to_json), cc_json = VALUES(cc_json),
           subject = VALUES(subject), body_plain = VALUES(body_plain),
           attachment_metadata_json = VALUES(attachment_metadata_json), gmail_labels_json = VALUES(gmail_labels_json),
           is_read = VALUES(is_read), is_draft = VALUES(is_draft), is_sent = VALUES(is_sent), message_at = VALUES(message_at)`,
        [businessId, threadId, message.gmailMessageId, thread.gmailThreadId, direction, message.from,
          JSON.stringify(message.to), JSON.stringify(message.cc), message.subject, message.messageIdHeader || null,
          message.referencesHeader || null, message.bodyPlain, JSON.stringify(message.attachments), JSON.stringify(message.labels),
          message.labels.includes('UNREAD') ? 0 : 1, direction === 'draft' ? 1 : 0, direction === 'outbound' ? 1 : 0, message.messageAt],
      );
    }
    await connection.commit();
    return thread.messages.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function syncCustomerServiceMailbox(businessId: string, options?: { days?: number }): Promise<{
  threads: number;
  messages: number;
}> {
  const settings = await getCustomerServiceSettings(businessId);
  const days = Math.max(1, Math.min(90, options?.days ?? settings.lookbackDays));
  const { accessToken, mailboxEmail } = await getGmailAccess(businessId);
  const threads = await fetchRecentGmailThreads(accessToken, days);
  let messages = 0;
  for (const thread of threads) messages += await upsertThread(businessId, mailboxEmail, thread);
  return { threads: threads.length, messages };
}