import { describe, expect, it } from 'vitest';
import guards from '../../../../scripts/amazon-pii-guards.json';
import { AMAZON_PII_CONTACT_FIELDS, AMAZON_PII_ORDER_FIELDS } from '../amazonPiiDisposal';

describe('shared tenant database privacy guard definitions', () => {
  it('protects every cleared order and contact field without silently rewriting input', () => {
    const order = guards.find(guard => guard.name === 'trg_amazon_pii_order_update')!;
    const contact = guards.find(guard => guard.name === 'trg_amazon_pii_contact_update')!;
    for (const field of AMAZON_PII_ORDER_FIELDS) expect(order.body).toContain(`NEW.${field}`);
    for (const field of AMAZON_PII_CONTACT_FIELDS) expect(contact.body).toContain(`NEW.${field}`);
    for (const guard of guards) {
      expect(guard.body).toContain("SIGNAL SQLSTATE '45000'");
      expect(guard.body).not.toMatch(/SET NEW\./);
      if (guard.table !== 'ims_amazon_pii_disposals') {
        expect(guard.body).toContain('business_id');
        expect(guard.body).toContain('LOCK IN SHARE MODE');
      }
    }
    expect(new Set(guards.map(guard => guard.name)).size).toBe(guards.length);
  });
  it('keeps suppression evidence immutable and guards label regeneration and recipient snapshots', () => {
    for (const name of ['trg_amazon_pii_receipt_update', 'trg_amazon_pii_receipt_delete',
      'trg_amazon_pii_order_insert', 'trg_amazon_pii_order_delete',
      'trg_amazon_pii_shipment_insert', 'trg_amazon_pii_shipment_update',
      'trg_amazon_pii_amendment_insert', 'trg_amazon_pii_amendment_update',
      'trg_amazon_pii_label_insert', 'trg_amazon_pii_label_update']) {
      expect(guards.some(guard => guard.name === name)).toBe(true);
    }
  });
});
