import { describe, expect, it } from 'vitest';
import { ShopifyOrderReviewRequiredError } from '../shopifyOrderReview';

describe('ShopifyOrderReviewRequiredError', () => {
  it('exposes stable quarantine classification without parsing the message', () => {
    const error = new ShopifyOrderReviewRequiredError('missing_variant_mapping', 'Map the source variant.');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'ShopifyOrderReviewRequiredError',
      code: 'SHOPIFY_ORDER_REVIEW_REQUIRED',
      reason: 'missing_variant_mapping',
      message: 'Map the source variant.',
    });
  });
});
