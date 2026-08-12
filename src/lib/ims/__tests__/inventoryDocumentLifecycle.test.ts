import { describe, expect, it } from 'vitest';
import {
  assertAllowedInventoryDocumentAction,
  buildInventoryDocumentOperationKey,
  getInventoryDocumentActionTarget,
} from '../inventoryDocumentLifecycle';

describe('inventory document lifecycle policy', () => {
  it('keeps customer credit-note completion and correction behind named actions', () => {
    expect(getInventoryDocumentActionTarget('customer_credit_note', 'draft', 'mark_awaiting_product')).toBe('awaiting_product');
    expect(getInventoryDocumentActionTarget('customer_credit_note', 'awaiting_product', 'resume_draft')).toBe('draft');
    expect(getInventoryDocumentActionTarget('customer_credit_note', 'awaiting_product', 'complete')).toBe('complete');
    expect(getInventoryDocumentActionTarget('customer_credit_note', 'complete', 'edit')).toBeNull();
    expect(getInventoryDocumentActionTarget('customer_credit_note', 'cancelled', 'delete')).toBeNull();
  });

  it('allows reversal only for manual customer credit notes', () => {
    expect(getInventoryDocumentActionTarget(
      'customer_credit_note',
      'complete',
      'revert_mistaken_completion',
      { customerCreditNoteSource: 'manual' },
    )).toBe('reversed');

    for (const source of ['pos', 'shopify', 'so_shortfall'] as const) {
      expect(getInventoryDocumentActionTarget(
        'customer_credit_note',
        'complete',
        'revert_mistaken_completion',
        { customerCreditNoteSource: source },
      )).toBeNull();
    }
  });

  it('retains cancelled supplier notes and restricts hard deletion to drafts', () => {
    expect(getInventoryDocumentActionTarget('supplier_credit_note', 'draft', 'cancel')).toBe('cancelled');
    expect(getInventoryDocumentActionTarget('supplier_credit_note', 'draft', 'delete')).toBe('draft');
    expect(getInventoryDocumentActionTarget('supplier_credit_note', 'cancelled', 'delete')).toBeNull();
    expect(getInventoryDocumentActionTarget('supplier_credit_note', 'complete', 'revert_mistaken_completion')).toBe('reversed');
  });

  it('requires named stocktake apply and revert actions', () => {
    expect(getInventoryDocumentActionTarget('stocktake', 'draft', 'start')).toBe('in_progress');
    expect(getInventoryDocumentActionTarget('stocktake', 'in_progress', 'complete')).toBe('completed');
    expect(getInventoryDocumentActionTarget('stocktake', 'completed', 'revert_mistaken_completion')).toBe('reverted');
    expect(getInventoryDocumentActionTarget('stocktake', 'in_progress', 'delete')).toBeNull();
    expect(() => assertAllowedInventoryDocumentAction('stocktake', 'completed', 'cancel')).toThrow(
      'stocktake cannot perform cancel from completed.',
    );
  });

  it('builds canonical operation keys that change with action, revision, or payload', async () => {
    const payload = { reason: 'Count entered twice', lines: [{ id: 2, qty: 1 }] };
    const reordered = { lines: [{ qty: 1, id: 2 }], reason: 'Count entered twice' };
    const first = await buildInventoryDocumentOperationKey('stocktake', 42, 'revert_mistaken_completion', 'revision-1', payload);

    expect(await buildInventoryDocumentOperationKey('stocktake', 42, 'revert_mistaken_completion', 'revision-1', reordered)).toBe(first);
    expect(await buildInventoryDocumentOperationKey('stocktake', 42, 'revert_mistaken_completion', 'revision-2', payload)).not.toBe(first);
    expect(await buildInventoryDocumentOperationKey('stocktake', 42, 'complete', 'revision-1', payload)).not.toBe(first);
    expect(await buildInventoryDocumentOperationKey('stocktake', 42, 'revert_mistaken_completion', 'revision-1', { ...payload, reason: 'Wrong location' })).not.toBe(first);
  });
});