import { reportRuntimeIssue, type ReportRuntimeIssueInput } from '@/lib/runtimeIssues';

export function getXeroConfigurationNotice(error: unknown): { reason: string; message: string } | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (message.includes('You cannot save this transaction using an inventory account type')) {
    return { reason: 'invalid_account_type', message: 'Xero rejected the mapped inventory account for this transaction. Review Accounts & Tracking and select a supported account before retrying the accounting action.' };
  }
  if (/missing[^\n]*\bmappings?\b|no[^\n]*account mapped/i.test(message)) {
    return { reason: 'missing_mapping', message: 'A required Xero mapping is missing. Review Accounts & Tracking and Payment Methods, complete the required mapping, then retry the unfinished accounting action.' };
  }
  if (/Xero API GET \/Invoices\/[^\s]+ failed \(404\)/i.test(message)) {
    return { reason: 'missing_linked_invoice', message: 'The linked invoice could not be found in the connected Xero organisation. Check the connection and the source document link before retrying. Do not repeat the sale or fulfilment.' };
  }
  return null;
}

export async function reportXeroFailure(input: ReportRuntimeIssueInput): Promise<void> {
  const notice = getXeroConfigurationNotice(input.error);
  if (!notice || !input.businessId) {
    await reportRuntimeIssue(input);
    return;
  }
  try {
    const { runImsForBusiness } = await import('@/lib/db/BusinessRegistry');
    const { createNotification } = await import('@/lib/ims/createNotification');
    await runImsForBusiness(input.businessId, () => createNotification(
      input.businessId!,
      'xero_configuration',
      `Xero setup needs attention: ${input.operation.replace(/_/g, ' ')}`,
      `${notice.message}${input.reference ? ` Affected ${input.reference.type.replace(/_/g, ' ')}: ${input.reference.id}.` : ''}`,
      { reason: notice.reason, operation: input.operation, reference: input.reference ?? null },
      'warning',
    ));
  } catch (error) {
    await reportRuntimeIssue({
      businessId: input.businessId,
      source: 'xero_notifications',
      operation: 'persist_configuration_notification',
      title: 'Xero configuration notification could not be saved',
      error,
      context: { originalOperation: input.operation, reason: notice.reason },
      reference: input.reference,
    });
  }
}