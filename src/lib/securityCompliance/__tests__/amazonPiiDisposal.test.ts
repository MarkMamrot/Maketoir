import { describe, expect, it } from 'vitest';
import { hasIdentifyingContactFields, isAmazonPiiWriteConflict, scrubAmazonBuyerFields, validateAmazonPiiDisposalRequest } from '../amazonPiiDisposal';

describe('targeted Amazon identifying-field cleanup', () => {
  it('clears recipient identity without changing product names, notes, amounts or sender data', () => {
    const input = {
      recipient: { name: 'Jane', lines: ['12 Example St'], email: 'jane@example.test', phone: '123', postcode: '2000' },
      sender: { name: 'Shop', lines: ['Warehouse'], phone: '456' },
      items: [{ name: 'Product title', notes: 'Keep this description', quantity: 2, amount: 11 }],
      notes: 'Not automatically classified', amazonOrderId: '111-2222222-3333333',
    };
    const result = scrubAmazonBuyerFields(input);
    expect(result.fields).toBe(5);
    expect(result.value).toEqual({
      ...input, recipient: { name: 'Amazon Customer', lines: [], email: '', phone: '', postcode: '' },
    });
    expect(input.recipient.name).toBe('Jane');
    expect(scrubAmazonBuyerFields(result.value).fields).toBe(0);
  });
  it('handles carrier readbacks and amendment order projections without touching merchant identity', () => {
    expect(scrubAmazonBuyerFields({
      carrier: { to: { name: 'Jane', address_line_1: 'Street' }, from: { name: 'Business' } },
      detail: { order: { customer_name: 'Jane', customer_email: 'jane@example.test', delivery_address: 'Street', total: 33 } },
    }).value).toEqual({
      carrier: { to: { name: 'Amazon Customer', address_line_1: '' }, from: { name: 'Business' } },
      detail: { order: { customer_name: 'Amazon Customer', customer_email: '', delivery_address: '', total: 33 } },
    });
  });
  it('does not treat generic customer names or a country alone as identifying contact details', () => {
    expect(hasIdentifyingContactFields({ name: 'Online Customer', country: 'Australia' })).toBe(false);
    expect(hasIdentifyingContactFields({ name: 'Amazon Customer', email: 'jane@example.test' })).toBe(true);
    expect(hasIdentifyingContactFields({ name: 'Jane' })).toBe(true);
    expect(hasIdentifyingContactFields({ date_of_birth: '1990-01-01' })).toBe(true);
  });
  it('scrubs embedded recipient JSON and only classifies actual database privacy guards as conflicts', () => {
    const result = scrubAmazonBuyerFields({ recipient_json: JSON.stringify({ name: 'Jane', email: 'jane@example.test' }) });
    expect(result.fields).toBe(2);
    expect(result.value).toEqual({ recipient_json: '{"name":"Amazon Customer","email":""}' });
    const error = Object.assign(new Error('Amazon buyer fields were cleared and cannot be restored'), { sqlState: '45000' });
    expect(isAmazonPiiWriteConflict(error)).toBe(true);
    expect(isAmazonPiiWriteConflict(new Error(error.message))).toBe(false);
  });
  it('fails safely on malformed or excessively deep JSON, without echoing stored buyer data', () => {
    expect(() => scrubAmazonBuyerFields('Jane private malformed')).toThrow('snapshot is invalid');
    let node: unknown = {};
    for (let n = 0; n < 35; n++) node = { nested: node };
    expect(() => scrubAmazonBuyerFields(node)).toThrow('review limit');
  });
  it('requires exact confirmation, tenant expectation and an idempotency key', () => {
    const request = {
      expectedBusinessId: 'tenant-a', salesOrderId: 42, token: 'a'.repeat(64),
      expiresAt: '2026-10-15T10:00:00.000Z', operationKey: '12345678-1234-4234-9234-123456789abc',
      confirmation: 'CLEAR AMAZON PII 42',
    };
    expect(validateAmazonPiiDisposalRequest(request)).toEqual(request);
    for (const bad of [{ confirmation: 'yes' }, { actorUserId: 1 }, { salesOrderId: 0 }, { token: 'bad' }]) {
      expect(() => validateAmazonPiiDisposalRequest({ ...request, ...bad })).toThrow();
    }
  });
});
