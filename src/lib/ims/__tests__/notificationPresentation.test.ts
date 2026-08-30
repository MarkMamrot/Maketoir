import { describe, expect, it } from 'vitest';

import { buildNotificationDetailSections, buildPosStockNotificationMessage } from '../notificationPresentation';

describe('buildNotificationDetailSections', () => {
  it('presents POS stock warnings as friendly product facts', () => {
    const sections = buildNotificationDetailSections({
      sale_id: 580649,
      warnings: [{
        reason: 'negative_stock',
        itemName: 'Seagulls Dusky Blue Womens Jumper - M',
        variantId: '8aa5c4d8-48b9-4d05-b44c-3b96f691d375',
        previousOnHand: 0,
        resultingOnHand: 0,
        quantityCommitted: 0,
        uncappedResultingOnHand: -1,
        automaticAdjustmentQuantity: 1,
      }],
    });

    expect(sections).toEqual([
      { heading: 'Summary', facts: [{ label: 'POS sale', value: '580649' }] },
      {
        heading: 'Seagulls Dusky Blue Womens Jumper - M',
        facts: expect.arrayContaining([
          { label: 'Reason', value: 'Sale exceeded recorded stock on hand' },
          { label: 'Stock before sale', value: '0' },
          { label: 'Stock without correction', value: '-1' },
          { label: 'Automatic stock correction', value: '1' },
          { label: 'Final stock on hand', value: '0' },
        ]),
      },
    ]);
    expect(JSON.stringify(sections)).not.toContain('8aa5c4d8');
  });

  it('presents error lists and nested stock locations', () => {
    const sections = buildNotificationDetailSections({
      errors: ['First order failed', 'Second order failed'],
      items: [{ product_name: 'Blue Tee', sku: 'BT-1', stock: [{ location: 'Warehouse', qty_on_hand: 2 }] }],
    });

    expect(sections.find(section => section.heading === 'Errors')?.facts).toHaveLength(2);
    expect(sections.find(section => section.heading === 'Blue Tee')?.facts).toEqual(expect.arrayContaining([
      { label: 'SKU', value: 'BT-1' },
      { label: 'Stock 1: Location', value: 'Warehouse' },
      { label: 'Stock 1: Stock on hand', value: '2' },
    ]));
  });

  it('keeps nested context visible without exposing technical identifiers', () => {
    const sections = buildNotificationDetailSections({
      context: { operation: 'Inventory update', attempt: 3, variant_id: 'internal-id' },
    });

    expect(sections).toEqual([{ heading: 'Context', facts: [
      { label: 'Operation', value: 'Inventory update' },
      { label: 'Attempt', value: '3' },
    ] }]);
  });

  it('explains every affected POS product in the notification message', () => {
    const message = buildPosStockNotificationMessage(580649, [{
      reason: 'negative_stock',
      itemName: 'Seagulls Dusky Blue Womens Jumper - M',
      previousOnHand: 0,
      resultingOnHand: 0,
      quantityCommitted: 0,
      uncappedResultingOnHand: -1,
      automaticAdjustmentQuantity: 1,
    }]);

    expect(message).toContain('Sale #580649 changed stock that needs checking');
    expect(message).toContain('Seagulls Dusky Blue Womens Jumper - M');
    expect(message).toContain('recorded stock 0');
    expect(message).toContain('automatic correction +1');
  });
});