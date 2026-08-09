import { execute, query } from '@/services/MySQLService';

export type XeroAccountingActionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';

export interface XeroAccountingAction {
  id: number;
  businessId: string;
  operationKey: string;
  actionType: string;
  sourceType: string;
  sourceId: string;
  requestFingerprint: string;
  status: XeroAccountingActionStatus;
  xeroId: string | null;
  safeError: string | null;
  attemptCount: number;
}

interface XeroAccountingActionRow {
  id: number;
  business_id: string;
  operation_key: string;
  action_type: string;
  source_type: string;
  source_id: string;
  request_fingerprint: string;
  status: XeroAccountingActionStatus;
  xero_id: string | null;
  safe_error: string | null;
  attempt_count: number;
}

type ActionDependencies = {
  query: typeof query;
  execute: typeof execute;
};

const defaultDependencies: ActionDependencies = { query, execute };

function mapAction(row: XeroAccountingActionRow): XeroAccountingAction {
  return {
    id: row.id,
    businessId: row.business_id,
    operationKey: row.operation_key,
    actionType: row.action_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    requestFingerprint: row.request_fingerprint,
    status: row.status,
    xeroId: row.xero_id,
    safeError: row.safe_error,
    attemptCount: row.attempt_count,
  };
}

async function getAction(
  businessId: string,
  operationKey: string,
  dependencies: ActionDependencies,
): Promise<XeroAccountingAction | null> {
  const rows = await dependencies.query<XeroAccountingActionRow>(
    `SELECT id, business_id, operation_key, action_type, source_type, source_id,
            request_fingerprint, status, xero_id, safe_error, attempt_count
       FROM xero_accounting_actions
      WHERE business_id = ? AND operation_key = ?
      LIMIT 1`,
    [businessId, operationKey],
  );
  return rows[0] ? mapAction(rows[0]) : null;
}

export async function claimXeroAccountingAction(
  input: {
    businessId: string;
    operationKey: string;
    actionType: string;
    sourceType: string;
    sourceId: string | number;
    requestFingerprint: string;
  },
  dependencies: ActionDependencies = defaultDependencies,
): Promise<{ claimed: boolean; action: XeroAccountingAction }> {
  await dependencies.execute(
    `INSERT IGNORE INTO xero_accounting_actions
       (business_id, operation_key, action_type, source_type, source_id, request_fingerprint, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [input.businessId, input.operationKey, input.actionType, input.sourceType, String(input.sourceId), input.requestFingerprint],
  );

  const action = await getAction(input.businessId, input.operationKey, dependencies);
  if (!action) throw new Error('Xero accounting action could not be loaded after creation.');
  if (action.requestFingerprint !== input.requestFingerprint) {
    throw new Error('Xero accounting action payload does not match the original request.');
  }

  const result = await dependencies.execute(
    `UPDATE xero_accounting_actions
        SET status = 'running', attempt_count = attempt_count + 1,
            last_attempt_at = NOW(), safe_error = NULL
      WHERE id = ? AND status IN ('pending', 'failed')`,
    [action.id],
  );
  const current = await getAction(input.businessId, input.operationKey, dependencies);
  if (!current) throw new Error('Xero accounting action disappeared after claim.');
  return { claimed: result.affectedRows === 1, action: current };
}

export async function completeXeroAccountingAction(
  actionId: number,
  xeroId: string,
  dependencies: ActionDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.execute(
    `UPDATE xero_accounting_actions
        SET status = 'succeeded', xero_id = ?, safe_error = NULL, completed_at = NOW()
      WHERE id = ? AND status = 'running'`,
    [xeroId, actionId],
  );
}

export async function failXeroAccountingAction(
  actionId: number,
  status: Extract<XeroAccountingActionStatus, 'failed' | 'unknown'>,
  safeError: string,
  dependencies: ActionDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.execute(
    `UPDATE xero_accounting_actions
        SET status = ?, safe_error = ?, completed_at = NULL
      WHERE id = ? AND status = 'running'`,
    [status, safeError.slice(0, 4000), actionId],
  );
}