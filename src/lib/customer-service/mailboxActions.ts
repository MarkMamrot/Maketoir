import { getGmailAccess, modifyGmailMessageLabels } from './gmailClient';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export async function updateCustomerServiceMailboxState(input: {
  businessId: string;
  threadId: number;
  action: 'read' | 'unread' | 'archive';
}): Promise<void> {
  const messages = await imsQuery<{ gmail_message_id: string }>(
    'SELECT gmail_message_id FROM ims_cs_messages WHERE business_id = ? AND thread_id = ?',
    [input.businessId, input.threadId],
  );
  if (!messages.length) throw new Error('Thread not found');
  const { accessToken } = await getGmailAccess(input.businessId);
  for (const message of messages) {
    if (input.action === 'read') await modifyGmailMessageLabels(accessToken, message.gmail_message_id, { removeLabelIds: ['UNREAD'] });
    if (input.action === 'unread') await modifyGmailMessageLabels(accessToken, message.gmail_message_id, { addLabelIds: ['UNREAD'] });
    if (input.action === 'archive') await modifyGmailMessageLabels(accessToken, message.gmail_message_id, { removeLabelIds: ['INBOX'] });
  }
  if (input.action === 'read') {
    await imsExecute('UPDATE ims_cs_messages SET is_read = 1 WHERE business_id = ? AND thread_id = ?', [input.businessId, input.threadId]);
    await imsExecute('UPDATE ims_cs_threads SET unread_count = 0 WHERE business_id = ? AND id = ?', [input.businessId, input.threadId]);
  } else if (input.action === 'unread') {
    await imsExecute('UPDATE ims_cs_messages SET is_read = 0 WHERE business_id = ? AND thread_id = ?', [input.businessId, input.threadId]);
    await imsExecute('UPDATE ims_cs_threads SET unread_count = message_count WHERE business_id = ? AND id = ?', [input.businessId, input.threadId]);
  } else {
    await imsExecute("UPDATE ims_cs_threads SET workflow_status = 'archived' WHERE business_id = ? AND id = ?", [input.businessId, input.threadId]);
  }
}