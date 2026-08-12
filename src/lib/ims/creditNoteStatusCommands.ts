import { getIMSPool } from '@/services/IMSMySQLService';
import {
  assertAllowedInventoryDocumentAction,
  type CustomerCreditNoteSource,
  type InventoryDocumentAction,
  type InventoryDocumentKind,
  type InventoryDocumentStatus,
} from './inventoryDocumentLifecycle';
import {
  claimInventoryDocumentOperation,
  completeInventoryDocumentOperation,
  type InventoryDocumentOperationContext,
} from './inventoryDocumentOperations';

type CreditNoteDocumentKind = Extract<InventoryDocumentKind, 'customer_credit_note' | 'supplier_credit_note'>;
type CreditNoteStatusAction = Extract<InventoryDocumentAction, 'mark_awaiting_product' | 'resume_draft' | 'cancel'>;

interface CreditNoteStatusRow {
  id: number;
  status: InventoryDocumentStatus;
  source?: CustomerCreditNoteSource;
  updated_at: Date | string | null;
}

export interface CreditNoteStatusCommandInput {
  businessId: string;
  documentKind: CreditNoteDocumentKind;
  documentId: number;
  action: CreditNoteStatusAction;
  context: InventoryDocumentOperationContext;
}

export interface CreditNoteStatusCommandResult {
  id: number;
  status: InventoryDocumentStatus;
  updatedAt: string | null;
  replayed: boolean;
}

export class InventoryDocumentRevisionConflict extends Error {
  readonly code = 'inventory_document_revision_conflict';

  constructor(message = 'This document changed after you opened it. Refresh and review the latest values before continuing.') {
    super(message);
    this.name = 'InventoryDocumentRevisionConflict';
  }
}

export function assertExpectedInventoryDocumentRevision(actual: unknown, expected: string | null | undefined): void {
  if (!expected) return;
  const actualTime = actual instanceof Date ? actual.getTime() : new Date(String(actual ?? '')).getTime();
  const expectedTime = new Date(expected).getTime();
  if (!Number.isFinite(actualTime) || !Number.isFinite(expectedTime) || actualTime !== expectedTime) {
    throw new InventoryDocumentRevisionConflict();
  }
}

function documentTable(kind: CreditNoteDocumentKind): string {
  return kind === 'customer_credit_note' ? 'ims_credit_notes' : 'ims_supplier_credit_notes';
}

export async function executeCreditNoteStatusCommand(
  input: CreditNoteStatusCommandInput,
): Promise<CreditNoteStatusCommandResult> {
  const pool = getIMSPool();
  const connection = await pool.getConnection();
  const table = documentTable(input.documentKind);
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<any[]>(
      `SELECT id, status, updated_at${input.documentKind === 'customer_credit_note' ? ', source' : ''}
         FROM ${table}
        WHERE id = ? AND business_id = ?
        FOR UPDATE`,
      [input.documentId, input.businessId],
    );
    const document = rows[0] as CreditNoteStatusRow | undefined;
    if (!document) throw new Error('Credit note not found');

    const claim = await claimInventoryDocumentOperation<CreditNoteStatusCommandResult>(
      connection,
      input.context,
      {
        businessId: input.businessId,
        documentKind: input.documentKind,
        documentId: input.documentId,
        action: input.action,
        documentStatus: document.status,
        beforeMetadata: { status: document.status },
      },
    );
    if (claim.replayed) {
      await connection.commit();
      return { ...claim.response!, replayed: true };
    }

    assertExpectedInventoryDocumentRevision(document.updated_at, input.context.expectedUpdatedAt);
    const resultingStatus = assertAllowedInventoryDocumentAction(
      input.documentKind,
      document.status,
      input.action,
      input.documentKind === 'customer_credit_note'
        ? { customerCreditNoteSource: document.source }
        : {},
    );

    await connection.execute(
      `UPDATE ${table} SET status = ? WHERE id = ? AND business_id = ?`,
      [resultingStatus, input.documentId, input.businessId],
    );
    const [updatedRows] = await connection.execute<any[]>(
      `SELECT updated_at FROM ${table} WHERE id = ? AND business_id = ?`,
      [input.documentId, input.businessId],
    );
    const updatedAtValue = updatedRows[0]?.updated_at;
    const response: CreditNoteStatusCommandResult = {
      id: input.documentId,
      status: resultingStatus,
      updatedAt: updatedAtValue == null
        ? null
        : updatedAtValue instanceof Date
          ? updatedAtValue.toISOString()
          : String(updatedAtValue),
      replayed: false,
    };
    await completeInventoryDocumentOperation(
      connection,
      input.businessId,
      claim.operationId,
      resultingStatus,
      response,
      { status: resultingStatus },
    );
    await connection.commit();
    return response;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}