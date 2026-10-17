export type ShopifyOrderReviewReason =
  | 'missing_variant_mapping'
  | 'ambiguous_variant_mapping'
  | 'invalid_source_line_identity'
  | 'existing_order_mapping_mismatch'
  | 'fulfilment_stock_conflict'
  | 'source_provenance_conflict';

export class ShopifyOrderReviewRequiredError extends Error {
  readonly code = 'SHOPIFY_ORDER_REVIEW_REQUIRED';

  constructor(readonly reason: ShopifyOrderReviewReason, message: string) {
    super(message);
    this.name = 'ShopifyOrderReviewRequiredError';
  }
}
