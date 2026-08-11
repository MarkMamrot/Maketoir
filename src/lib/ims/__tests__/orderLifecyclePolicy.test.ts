import { describe, expect, it } from 'vitest';
import {
  assertAllowedPOStatusTransition,
  assertAllowedSOStatusTransition,
  buildOrderStatusOperationKey,
  getOrderStatusLabel,
  getPhysicalCompletionLabel,
  isAllowedPOStatusTransition,
  isAllowedSOStatusTransition,
} from '../orderLifecyclePolicy';

describe('order lifecycle policy', () => {
  it('allows only explicit purchase-order transitions', () => {
    expect(isAllowedPOStatusTransition('draft', 'confirmed')).toBe(true);
    expect(isAllowedPOStatusTransition('confirmed', 'complete')).toBe(false);
    expect(isAllowedPOStatusTransition('partially_received', 'confirmed')).toBe(false);
    expect(isAllowedPOStatusTransition('partially_received', 'complete')).toBe(false);
    expect(isAllowedPOStatusTransition('partially_received', 'cancelled')).toBe(false);
    expect(isAllowedPOStatusTransition('complete', 'confirmed')).toBe(false);
    expect(isAllowedPOStatusTransition('complete', 'cancelled')).toBe(true);
    expect(isAllowedPOStatusTransition('cancelled', 'draft')).toBe(false);
    expect(() => assertAllowedPOStatusTransition('confirmed', 'partially_received')).toThrow(
      'Purchase order cannot change from confirmed to partially_received.',
    );
  });

  it('allows only explicit sales-order transitions', () => {
    expect(isAllowedSOStatusTransition('draft', 'confirmed')).toBe(true);
    expect(isAllowedSOStatusTransition('partially_fulfilled', 'fulfilled')).toBe(true);
    expect(isAllowedSOStatusTransition('fulfilled', 'draft')).toBe(false);
    expect(() => assertAllowedSOStatusTransition('fulfilled', 'draft')).toThrow(
      'Sales order cannot change from fulfilled to draft.',
    );
  });

  it('uses a shared completed category with precise physical labels', () => {
    expect(getOrderStatusLabel('purchase_order', 'complete')).toBe('Completed');
    expect(getOrderStatusLabel('sales_order', 'fulfilled')).toBe('Completed');
    expect(getOrderStatusLabel('purchase_order', 'partially_received')).toBe('Partially Received');
    expect(getPhysicalCompletionLabel('purchase_order')).toBe('Fully received');
    expect(getPhysicalCompletionLabel('sales_order')).toBe('Fully fulfilled');
  });

  it('builds stable status operation keys that change with status or revision', () => {
    const first = buildOrderStatusOperationKey('purchase_order', 42, 'cancelled', '2026-08-11T10:00:00.000Z');
    expect(buildOrderStatusOperationKey('purchase_order', 42, 'cancelled', '2026-08-11T10:00:00.000Z')).toBe(first);
    expect(buildOrderStatusOperationKey('purchase_order', 42, 'confirmed', '2026-08-11T10:00:00.000Z')).not.toBe(first);
    expect(buildOrderStatusOperationKey('purchase_order', 42, 'cancelled', '2026-08-11T11:00:00.000Z')).not.toBe(first);
  });
});