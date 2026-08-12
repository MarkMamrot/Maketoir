import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { getIMSPool, imsExecute } from '@/services/IMSMySQLService';
import { assertExpectedInventoryDocumentRevision } from '../creditNoteStatusCommands';
import { assertAllowedInventoryDocumentAction } from '../inventoryDocumentLifecycle';
import {
  claimInventoryDocumentOperation,
  completeInventoryDocumentOperation,
  type InventoryDocumentOperationContext,
} from '../inventoryDocumentOperations';

type CreditNoteKind = 'customer_credit_note' | 'supplier_credit_note';

interface ReversalInput {
  businessId: string;
  documentId: number;
  reason: string;
  context: InventoryDocumentOperationContext;
  xeroCorrectionRequired: boolean;
}

interface MovementEvidence extends RowDataPacket {
  id: number;
  variant_id: string;
  location_id: number;
  qty_change: number;
  unit_cost: number | null;
}

export interface CreditNoteReversalResult {
  id: number;
  status: 'reversed';
  replayed: boolean;
  xeroCorrectionStatus: 'not_required' | 'queued';
}

export class CreditNoteReversalConflict extends Error {
  readonly code = 'credit_note_reversal_conflict';

  constructor(message: string) {
    super(message);
    this.name = 'CreditNoteReversalConflict';
  }
}

function normalizedReason(reason: string): string {
  const value = String(reason ?? '').trim();
  if (!value) throw new CreditNoteReversalConflict('A reversal reason is required.');
  if (value.length > 500) throw new CreditNoteReversalConflict('The reversal reason must be 500 characters or fewer.');
  return value;
}

async function lockMovementEvidence(
  connection: PoolConnection,
  businessId: string,
  documentId: number,
  movementType: 'cn_returned' | 'scn_returned',
  expectedSign: 'positive' | 'negative',
): Promise<MovementEvidence[]> {
  const [rows] = await connection.execute<MovementEvidence[]>(
    `SELECT id, variant_id, location_id, qty_change, unit_cost
       FROM ims_stock_movements
      WHERE business_id = ? AND reference_id = ? AND movement_type = ?
      ORDER BY id
      FOR UPDATE`,
    [businessId, documentId, movementType],
  );
  for (const row of rows) {
    const quantity = Number(row.qty_change);
    if ((expectedSign === 'positive' && !(quantity > 0)) || (expectedSign === 'negative' && !(quantity < 0))) {
      throw new CreditNoteReversalConflict('The original stock movement evidence is inconsistent and cannot be reversed automatically.');
    }
  }
  return rows;
}

async function lockStock(
  connection: PoolConnection,
  businessId: string,
  variantId: string,
  locationId: number,
): Promise<number> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT qty_on_hand
       FROM ims_stock
      WHERE business_id = ? AND variant_id = ? AND location_id = ?
      FOR UPDATE`,
    [businessId, variantId, locationId],
  );
  if (!rows[0]) throw new CreditNoteReversalConflict(`Stock for variant ${variantId} could not be verified at the original location.`);
  return Number(rows[0].qty_on_hand);
}

export async function reverseCustomerCreditNote(input: ReversalInput): Promise<CreditNoteReversalResult> {
  const reason = normalizedReason(input.reason);
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [headerRows] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM ims_credit_notes WHERE id = ? AND business_id = ? FOR UPDATE`,
      [input.documentId, input.businessId],
    );
    const note = headerRows[0];
    if (!note) throw new CreditNoteReversalConflict('Customer credit note not found.');
    const operation = await claimInventoryDocumentOperation<CreditNoteReversalResult>(connection, input.context, {
      businessId: input.businessId,
      documentKind: 'customer_credit_note',
      documentId: input.documentId,
      action: 'revert_mistaken_completion',
      documentStatus: note.status,
      beforeMetadata: { status: note.status, source: note.source, settlementMethod: note.settlement_method },
    });
    if (operation.replayed) {
      await connection.commit();
      return operation.response ?? {
        id: input.documentId,
        status: 'reversed',
        replayed: true,
        xeroCorrectionStatus: input.xeroCorrectionRequired ? 'queued' : 'not_required',
      };
    }
    assertExpectedInventoryDocumentRevision(note.updated_at, input.context.expectedUpdatedAt);
    assertAllowedInventoryDocumentAction(
      'customer_credit_note',
      note.status,
      'revert_mistaken_completion',
      { customerCreditNoteSource: note.source },
    );
    if (note.settlement_method !== 'store_credit' || !note.store_credit_transaction_id || !note.customer_id) {
      throw new CreditNoteReversalConflict('Only manual credit notes with a verifiable store-credit issue can be reversed automatically.');
    }

    const [creditRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, amount
         FROM store_credit_transactions
        WHERE id = ? AND credit_note_id = ? AND contact_id = ? AND type = 'issue'
        FOR UPDATE`,
      [note.store_credit_transaction_id, input.documentId, note.customer_id],
    );
    const originalCredit = creditRows[0];
    if (!originalCredit || !(Number(originalCredit.amount) > 0)) {
      throw new CreditNoteReversalConflict('The original store-credit issue could not be verified.');
    }
    const [contactRows] = await connection.execute<RowDataPacket[]>(
      `SELECT store_credit FROM ims_contacts WHERE id = ? AND business_id = ? FOR UPDATE`,
      [note.customer_id, input.businessId],
    );
    const currentCredit = Number(contactRows[0]?.store_credit ?? Number.NaN);
    const issuedCredit = Number(originalCredit.amount);
    if (!Number.isFinite(currentCredit) || currentCredit + 0.0001 < issuedCredit) {
      throw new CreditNoteReversalConflict('The customer has already spent some of this store credit. Restore the balance before reversing this credit note.');
    }

    const movements = await lockMovementEvidence(connection, input.businessId, input.documentId, 'cn_returned', 'positive');
    for (const movement of movements) {
      const quantity = Number(movement.qty_change);
      const onHand = await lockStock(connection, input.businessId, movement.variant_id, Number(movement.location_id));
      if (onHand + 0.0001 < quantity) {
        throw new CreditNoteReversalConflict(`Variant ${movement.variant_id} has ${onHand} on hand but ${quantity} must be removed to reverse this return.`);
      }
      const resultingOnHand = onHand - quantity;
      await connection.execute(
        `UPDATE ims_stock SET qty_on_hand = ? WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
        [resultingOnHand, input.businessId, movement.variant_id, movement.location_id],
      );
      await connection.execute(
        `INSERT INTO ims_stock_movements
           (business_id, variant_id, location_id, movement_type, reference_type, reference_id,
            qty_change, qty_after_soh, unit_cost, notes)
         VALUES (?, ?, ?, 'cn_return_reversed', 'credit_note', ?, ?, ?, ?, ?)`,
        [input.businessId, movement.variant_id, movement.location_id, input.documentId, -quantity,
          resultingOnHand, movement.unit_cost, reason],
      );
    }

    const balanceAfter = Math.round((currentCredit - issuedCredit) * 100) / 100;
    await connection.execute(
      `INSERT INTO store_credit_transactions
         (contact_id, type, amount, balance_after, credit_note_id, idempotency_key, notes)
       VALUES (?, 'adjust', ?, ?, ?, ?, ?)`,
      [note.customer_id, -issuedCredit, balanceAfter, input.documentId,
        `credit-note-reversal:${input.businessId}:${input.documentId}`, `Reversed ${note.cn_number}: ${reason}`],
    );
    await connection.execute(
      `UPDATE ims_contacts SET store_credit = ? WHERE id = ? AND business_id = ?`,
      [balanceAfter, note.customer_id, input.businessId],
    );
    const xeroCorrectionStatus = input.xeroCorrectionRequired ? 'queued' : 'not_required';
    await connection.execute(
      `UPDATE ims_credit_notes
          SET status = 'reversed', reversed_at = NOW(), reversal_reason = ?, reversed_by = ?,
              settlement_status = 'complete', xero_correction_status = ?, xero_correction_error = NULL
        WHERE id = ? AND business_id = ?`,
      [reason, input.context.actorId ?? null, xeroCorrectionStatus, input.documentId, input.businessId],
    );
    const response: CreditNoteReversalResult = {
      id: input.documentId,
      status: 'reversed',
      replayed: false,
      xeroCorrectionStatus,
    };
    await completeInventoryDocumentOperation(
      connection,
      input.businessId,
      operation.operationId,
      'reversed',
      response,
      { status: 'reversed', stockMovementCount: movements.length, storeCreditReversed: issuedCredit, reason },
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

export async function reverseSupplierCreditNote(input: ReversalInput): Promise<CreditNoteReversalResult> {
  const reason = normalizedReason(input.reason);
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const [headerRows] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM ims_supplier_credit_notes WHERE id = ? AND business_id = ? FOR UPDATE`,
      [input.documentId, input.businessId],
    );
    const note = headerRows[0];
    if (!note) throw new CreditNoteReversalConflict('Supplier credit note not found.');
    const operation = await claimInventoryDocumentOperation<CreditNoteReversalResult>(connection, input.context, {
      businessId: input.businessId,
      documentKind: 'supplier_credit_note',
      documentId: input.documentId,
      action: 'revert_mistaken_completion',
      documentStatus: note.status,
      beforeMetadata: { status: note.status, poId: note.po_id },
    });
    if (operation.replayed) {
      await connection.commit();
      return operation.response ?? {
        id: input.documentId,
        status: 'reversed',
        replayed: true,
        xeroCorrectionStatus: input.xeroCorrectionRequired ? 'queued' : 'not_required',
      };
    }
    assertExpectedInventoryDocumentRevision(note.updated_at, input.context.expectedUpdatedAt);
    assertAllowedInventoryDocumentAction('supplier_credit_note', note.status, 'revert_mistaken_completion');

    const movements = await lockMovementEvidence(connection, input.businessId, input.documentId, 'scn_returned', 'negative');
    for (const movement of movements) {
      const quantity = -Number(movement.qty_change);
      const onHand = await lockStock(connection, input.businessId, movement.variant_id, Number(movement.location_id));
      const resultingOnHand = onHand + quantity;
      await connection.execute(
        `UPDATE ims_stock SET qty_on_hand = ? WHERE business_id = ? AND variant_id = ? AND location_id = ?`,
        [resultingOnHand, input.businessId, movement.variant_id, movement.location_id],
      );
      await connection.execute(
        `INSERT INTO ims_stock_movements
           (business_id, variant_id, location_id, movement_type, reference_type, reference_id,
            qty_change, qty_after_soh, unit_cost, notes)
         VALUES (?, ?, ?, 'scn_return_reversed', 'supplier_credit_note', ?, ?, ?, ?, ?)`,
        [input.businessId, movement.variant_id, movement.location_id, input.documentId, quantity,
          resultingOnHand, movement.unit_cost, reason],
      );
    }

    const xeroCorrectionStatus = input.xeroCorrectionRequired ? 'queued' : 'not_required';
    await connection.execute(
      `UPDATE ims_supplier_credit_notes
          SET status = 'reversed', reversed_at = NOW(), reversal_reason = ?, reversed_by = ?,
              xero_correction_status = ?, xero_correction_error = NULL
        WHERE id = ? AND business_id = ?`,
      [reason, input.context.actorId ?? null, xeroCorrectionStatus, input.documentId, input.businessId],
    );
    const response: CreditNoteReversalResult = {
      id: input.documentId,
      status: 'reversed',
      replayed: false,
      xeroCorrectionStatus,
    };
    await completeInventoryDocumentOperation(
      connection,
      input.businessId,
      operation.operationId,
      'reversed',
      response,
      { status: 'reversed', stockMovementCount: movements.length, reason },
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

export async function markCreditNoteCorrectionResult(
  kind: CreditNoteKind,
  businessId: string,
  documentId: number,
  status: 'synced' | 'error' | 'blocked',
  reference?: string | null,
  error?: string | null,
): Promise<void> {
  const table = kind === 'customer_credit_note' ? 'ims_credit_notes' : 'ims_supplier_credit_notes';
  await imsExecute(
    `UPDATE ${table}
        SET xero_correction_status = ?, xero_correction_reference = ?, xero_correction_error = ?
      WHERE id = ? AND business_id = ?`,
    [status, reference ?? null, error?.slice(0, 2000) ?? null, documentId, businessId],
  );
}