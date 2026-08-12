import { describe, expect, it, vi } from 'vitest';
import {
  claimInventoryDocumentOperation,
  completeInventoryDocumentOperation,
} from '../inventoryDocumentOperations';

function connectionWithRows(rows: any[]) {
  return { execute: vi.fn().mockResolvedValueOnce([rows]) } as any;
}

const context = {
  operationKey: 'stocktake:42:complete:revision:r1:request:abc',
  requestHash: 'a'.repeat(64),
  actorId: 7,
  actorName: 'Operator',
};

const input = {
  businessId: 'biz-1',
  documentKind: 'stocktake' as const,
  documentId: 42,
  action: 'complete' as const,
  documentStatus: 'in_progress' as const,
  beforeMetadata: { countedLines: 3 },
};

describe('inventory document operation ledger', () => {
  it('claims a new tenant-scoped operation', async () => {
    const connection = connectionWithRows([]);
    connection.execute.mockResolvedValueOnce([{ insertId: 91 }]);

    await expect(claimInventoryDocumentOperation(connection, context, input)).resolves.toEqual({
      operationId: 91,
      replayed: false,
      response: null,
    });
    expect(connection.execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO ims_inventory_document_operations'),
      expect.arrayContaining(['biz-1', context.operationKey, context.requestHash, 'stocktake', 42, 'complete']),
    );
  });

  it('replays a completed matching operation and returns its response', async () => {
    const connection = connectionWithRows([{
      id: 91,
      request_hash: context.requestHash,
      document_kind: 'stocktake',
      document_id: 42,
      action: 'complete',
      state: 'complete',
      response_json: JSON.stringify({ status: 'completed' }),
    }]);

    await expect(claimInventoryDocumentOperation(connection, context, input)).resolves.toEqual({
      operationId: 91,
      replayed: true,
      response: { status: 'completed' },
    });
    expect(connection.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects key reuse with a changed hash or document identity', async () => {
    const changedHash = connectionWithRows([{
      id: 91,
      request_hash: 'b'.repeat(64),
      document_kind: 'stocktake',
      document_id: 42,
      action: 'complete',
      state: 'complete',
      response_json: null,
    }]);
    await expect(claimInventoryDocumentOperation(changedHash, context, input)).rejects.toThrow(
      'operation key was already used with different document changes',
    );

    const changedDocument = connectionWithRows([{
      id: 91,
      request_hash: context.requestHash,
      document_kind: 'stocktake',
      document_id: 43,
      action: 'complete',
      state: 'complete',
      response_json: null,
    }]);
    await expect(claimInventoryDocumentOperation(changedDocument, context, input)).rejects.toThrow(
      'operation key was already used with different document changes',
    );
  });

  it('rejects a matching operation that is still processing', async () => {
    const connection = connectionWithRows([{
      id: 91,
      request_hash: context.requestHash,
      document_kind: 'stocktake',
      document_id: 42,
      action: 'complete',
      state: 'processing',
      response_json: null,
    }]);
    await expect(claimInventoryDocumentOperation(connection, context, input)).rejects.toThrow(
      'operation is already being processed',
    );
  });

  it('completes only the claimed processing row for the tenant', async () => {
    const connection = { execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) } as any;
    await completeInventoryDocumentOperation(
      connection,
      'biz-1',
      91,
      'completed',
      { status: 'completed' },
      { appliedLines: 3 },
    );
    expect(connection.execute).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ? AND business_id = ? AND state = 'processing'"),
      ['completed', '{"status":"completed"}', '{"appliedLines":3}', 91, 'biz-1'],
    );
  });
});