import { describe, expect, it } from 'vitest';

import { sanitizeAssistantScreenContext } from '../screenContext';

describe('assistant screen context', () => {
  it('keeps bounded operational fields and removes identity or credential fields', () => {
    const result = sanitizeAssistantScreenContext({
      screen: 'online-sales',
      order: {
        reference: '#1042',
        status: 'fulfilled',
        customerName: 'Private Customer',
        email: 'private@example.com',
        items: [{ product: 'Shopify Misc Charge', sku: 'SHOPIFY-MISC', quantity: 1 }],
      },
      accessToken: 'do-not-send',
    });

    expect(result).toEqual({
      screen: 'online-sales',
      order: {
        reference: '#1042',
        status: 'fulfilled',
        items: [{ product: 'Shopify Misc Charge', sku: 'SHOPIFY-MISC', quantity: 1 }],
      },
    });
  });

  it('rejects non-object context and bounds long strings', () => {
    expect(sanitizeAssistantScreenContext('raw html')).toBeNull();
    const result = sanitizeAssistantScreenContext({ note: 'x'.repeat(2_000) });
    expect(String(result?.note)).toHaveLength(500);
  });
});