import { describe, expect, it } from 'vitest';
import {
  addDaybookClipboardItem,
  formatDaybookClipboardRecord,
  serializeDaybookClipboard,
} from '../daybookClipboard';

describe('Store Daybook clipboard', () => {
  it('formats store needs for branch transfer notes', () => {
    expect(formatDaybookClipboardRecord({
      id: 3,
      recordType: 'store_need',
      title: 'Receipt rolls',
      details: { item: 'Receipt rolls', quantity: 4, unit: 'boxes', store_notes: 'Large size' },
    }).text).toBe('Store need: Receipt rolls\nItem: Receipt rolls\nQuantity: 4\nUnit: boxes\nStore notes: Large size');
  });

  it('formats explicitly selected customer requests with their entered details', () => {
    expect(formatDaybookClipboardRecord({
      id: 8,
      recordType: 'customer_request',
      title: 'Blue scarf',
      details: { customer_name: 'Alex', contact_details: '0400 000 000', item: 'Blue scarf', notes: '' },
    }).text).toContain('Customer: Alex\nContact: 0400 000 000\nItem: Blue scarf');
  });

  it('replaces a duplicate record and clearly separates multiline note blocks', () => {
    const first = { id: 1, recordType: 'store_need' as const, text: 'Old' };
    const replacement = { ...first, text: 'Updated' };
    const request = { id: 2, recordType: 'customer_request' as const, text: 'Request' };
    expect(serializeDaybookClipboard(addDaybookClipboardItem([first, request], replacement))).toBe(
      'Request\n\n--------------------\n\nUpdated',
    );
  });
});
