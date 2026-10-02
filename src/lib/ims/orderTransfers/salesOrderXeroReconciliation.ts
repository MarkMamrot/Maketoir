import { triggerSOXeroSync, triggerSOXeroUpdate, triggerSOXeroVoid } from '@/lib/ims/xeroHooks';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

type TransferResult = {
  replayed: boolean;
  sourceOrderId: number;
  targetOrderId: number;
  sourceStatus: string;
  targetStatus: string;
};

async function reportWarning(businessId: string, orderId: number, warning: string): Promise<void> {
  await reportRuntimeIssue({
    businessId,
    source: 'ims_sales_orders',
    operation: 'xero_transfer_reconciliation',
    title: 'Sales order items moved but Xero requires reconciliation',
    error: warning,
    reference: { type: 'sales_order', id: String(orderId) },
  }).catch(() => {});
}

export async function reconcileSalesOrderTransferXero(
  businessId: string,
  transfers: TransferResult[],
): Promise<string[]> {
  const pending = transfers.filter(transfer => !transfer.replayed);
  if (pending.length === 0) return [];
  const warnings: string[] = [];

  for (const transfer of pending) {
    try {
      const warning = transfer.sourceStatus === 'cancelled'
        ? await triggerSOXeroVoid(businessId, transfer.sourceOrderId)
        : (await triggerSOXeroUpdate(businessId, transfer.sourceOrderId)).warning;
      if (warning) {
        warnings.push(warning);
        await reportWarning(businessId, transfer.sourceOrderId, warning);
      }
    } catch (error) {
      const warning = `Sales Order ${transfer.sourceOrderId} was moved, but its Xero invoice could not be reconciled.`;
      warnings.push(warning);
      await reportWarning(businessId, transfer.sourceOrderId, error instanceof Error ? error.message : warning);
    }
  }

  const target = pending.at(-1)!;
  try {
    await triggerSOXeroSync(businessId, target.targetOrderId, target.targetStatus);
  } catch (error) {
    const warning = `Sales Order ${target.targetOrderId} received moved items, but its Xero invoice could not be reconciled.`;
    warnings.push(warning);
    await reportWarning(businessId, target.targetOrderId, error instanceof Error ? error.message : warning);
  }
  return warnings;
}