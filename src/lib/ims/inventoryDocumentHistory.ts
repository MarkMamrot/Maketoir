import { imsQuery } from '@/services/IMSMySQLService';
import type { InventoryDocumentKind } from './inventoryDocumentLifecycle';

export interface InventoryDocumentHistoryEntry {
  id: number;
  entryKey: string;
  activityType: 'inventory_document';
  title: string;
  summary: string;
  state: string;
  details: string[];
  previousStatus: string;
  resultingStatus: string;
  actorName: string | null;
  lineChangeCount: number;
  changedFields: string[];
  lines: [];
  createdAt: string;
  completedAt: string | null;
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? '');
}

const ACTION_LABELS: Record<string, string> = {
  mark_awaiting_product: 'Marked awaiting product',
  resume_draft: 'Resumed as Draft',
  complete: 'Completion applied',
  cancel: 'Cancelled',
  start: 'Count started',
  revert_mistaken_completion: 'Mistaken completion reversed',
};

export async function getInventoryDocumentActivityHistory(
  businessId: string,
  documentKind: InventoryDocumentKind,
  documentId: number,
): Promise<InventoryDocumentHistoryEntry[]> {
  const rows = await imsQuery<any>(
    `SELECT id, action, previous_status, resulting_status, actor_name,
            after_metadata_json, created_at, completed_at
       FROM ims_inventory_document_operations
      WHERE business_id = ? AND document_kind = ? AND document_id = ? AND state = 'complete'
      ORDER BY id DESC
      LIMIT 25`,
    [businessId, documentKind, documentId],
  );

  return rows.map(row => {
    const metadata = parseObject(row.after_metadata_json);
    const reason = typeof metadata?.reason === 'string' ? metadata.reason.slice(0, 500) : null;
    const details: string[] = [];
    if (reason) details.push(`Reason: ${reason}`);
    if (Number(metadata?.stockMovementCount ?? 0) > 0) {
      details.push(`${Number(metadata?.stockMovementCount)} stock movement${Number(metadata?.stockMovementCount) === 1 ? '' : 's'} compensated`);
    }
    if (Number(metadata?.storeCreditReversed ?? 0) > 0) {
      details.push(`Store credit reversed: $${Number(metadata?.storeCreditReversed).toFixed(2)}`);
    }
    if (Number(metadata?.appliedLineCount ?? 0) > 0) {
      details.push(`${Number(metadata?.appliedLineCount)} counted line${Number(metadata?.appliedLineCount) === 1 ? '' : 's'} applied`);
    }
    if (Number(metadata?.countStartVarianceCount ?? 0) > 0) {
      details.push(`${Number(metadata?.countStartVarianceCount)} count-start variance${Number(metadata?.countStartVarianceCount) === 1 ? '' : 's'}`);
    }
    if (Number(metadata?.actualAdjustmentCount ?? 0) > 0) {
      details.push(`${Number(metadata?.actualAdjustmentCount)} actual stock adjustment${Number(metadata?.actualAdjustmentCount) === 1 ? '' : 's'}`);
    }
    if (Number(metadata?.compensatedMovementCount ?? 0) > 0) {
      details.push(`${Number(metadata?.compensatedMovementCount)} compensation movement${Number(metadata?.compensatedMovementCount) === 1 ? '' : 's'}`);
    }
    return {
      id: Number(row.id),
      entryKey: `inventory-document:${row.id}`,
      activityType: 'inventory_document' as const,
      title: ACTION_LABELS[String(row.action)] ?? String(row.action ?? 'Document activity').replaceAll('_', ' '),
      summary: row.actor_name ? `By ${String(row.actor_name)}` : 'By System',
      state: String(row.resulting_status ?? row.previous_status ?? ''),
      details,
      previousStatus: String(row.previous_status ?? ''),
      resultingStatus: String(row.resulting_status ?? row.previous_status ?? ''),
      actorName: row.actor_name == null ? null : String(row.actor_name),
      lineChangeCount: 0,
      changedFields: [],
      lines: [],
      createdAt: toIso(row.created_at),
      completedAt: row.completed_at == null ? null : toIso(row.completed_at),
    };
  });
}
