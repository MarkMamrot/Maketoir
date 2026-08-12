import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type {
  InventoryDocumentAction,
  InventoryDocumentKind,
  InventoryDocumentStatus,
} from './inventoryDocumentLifecycle';

export interface InventoryDocumentOperationContext {
  operationKey: string;
  requestHash: string;
  expectedUpdatedAt?: string | null;
  actorId?: number | null;
  actorName?: string | null;
}

export interface InventoryDocumentOperationInput {
  businessId: string;
  documentKind: InventoryDocumentKind;
  documentId: number;
  action: InventoryDocumentAction;
  documentStatus: InventoryDocumentStatus;
  beforeMetadata?: unknown;
}

interface ExistingOperationRow extends RowDataPacket {
  id: number;
  request_hash: string;
  document_kind: InventoryDocumentKind;
  document_id: number;
  action: InventoryDocumentAction;
  state: 'processing' | 'complete';
  response_json: unknown;
}

export interface InventoryDocumentOperationClaim<TResponse = unknown> {
  operationId: number;
  replayed: boolean;
  response: TResponse | null;
}

export class InventoryDocumentOperationConflict extends Error {
  readonly code = 'inventory_document_operation_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'InventoryDocumentOperationConflict';
  }
}

function parseResponse<TResponse>(value: unknown): TResponse | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as TResponse;
    } catch {
      return null;
    }
  }
  return value as TResponse;
}

export async function claimInventoryDocumentOperation<TResponse = unknown>(
  connection: PoolConnection,
  context: InventoryDocumentOperationContext,
  input: InventoryDocumentOperationInput,
): Promise<InventoryDocumentOperationClaim<TResponse>> {
  const [rows] = await connection.execute<ExistingOperationRow[]>(
    `SELECT id, request_hash, document_kind, document_id, action, state, response_json
       FROM ims_inventory_document_operations
      WHERE business_id = ? AND operation_key = ?
      FOR UPDATE`,
    [input.businessId, context.operationKey],
  );
  const existing = rows[0];
  if (existing) {
    const sameIdentity =
      existing.document_kind === input.documentKind &&
      Number(existing.document_id) === input.documentId &&
      existing.action === input.action;
    if (!sameIdentity || String(existing.request_hash) !== context.requestHash) {
      throw new InventoryDocumentOperationConflict(
        'This operation key was already used with different document changes. Refresh and try again.',
      );
    }
    if (existing.state === 'complete') {
      return {
        operationId: Number(existing.id),
        replayed: true,
        response: parseResponse<TResponse>(existing.response_json),
      };
    }
    throw new InventoryDocumentOperationConflict(
      'This document operation is already being processed. Refresh before trying again.',
    );
  }

  const [result] = await connection.execute<any>(
    `INSERT INTO ims_inventory_document_operations
       (business_id, operation_key, request_hash, document_kind, document_id, action,
        previous_status, state, before_metadata_json, actor_id, actor_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`,
    [
      input.businessId,
      context.operationKey,
      context.requestHash,
      input.documentKind,
      input.documentId,
      input.action,
      input.documentStatus,
      input.beforeMetadata == null ? null : JSON.stringify(input.beforeMetadata),
      context.actorId ?? null,
      context.actorName ?? null,
    ],
  );
  return { operationId: Number(result.insertId), replayed: false, response: null };
}

export async function completeInventoryDocumentOperation(
  connection: PoolConnection,
  businessId: string,
  operationId: number,
  resultingStatus: InventoryDocumentStatus,
  response: unknown,
  afterMetadata?: unknown,
): Promise<void> {
  await connection.execute(
    `UPDATE ims_inventory_document_operations
        SET state = 'complete', resulting_status = ?, response_json = ?, after_metadata_json = ?, completed_at = NOW()
      WHERE id = ? AND business_id = ? AND state = 'processing'`,
    [
      resultingStatus,
      response == null ? null : JSON.stringify(response),
      afterMetadata == null ? null : JSON.stringify(afterMetadata),
      operationId,
      businessId,
    ],
  );
}