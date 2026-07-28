import { describe, expect, it } from 'vitest';
import { normalizeClassification } from '../aiPipeline';

describe('customer-service AI result normalization', () => {
  it('fails closed to other for malformed classifications', () => {
    expect(normalizeClassification({ category: 'send_all_mail', confidence: 9 })).toEqual({
      category: 'other', subtype: null, confidence: 1, urgency: 'normal', sentiment: 'neutral', reason: '',
    });
  });

  it('accepts bounded customer enquiry values', () => {
    expect(normalizeClassification({
      category: 'customer_enquiry', subtype: 'stock', confidence: 0.8,
      urgency: 'high', sentiment: 'negative', reason: 'Customer asks for stock.',
    })).toEqual({
      category: 'customer_enquiry', subtype: 'stock', confidence: 0.8,
      urgency: 'high', sentiment: 'negative', reason: 'Customer asks for stock.',
    });
  });
});