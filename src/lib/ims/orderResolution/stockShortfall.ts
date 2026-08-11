export type StockShortfall = {
  itemId: number;
  variantId: string;
  requestedQuantity: number;
  quantityOnHand: number;
  resultingQuantityOnHand: number;
};

export class StockShortfallError extends Error {
  readonly code = 'STOCK_SHORTFALL';

  constructor(readonly shortfalls: StockShortfall[]) {
    super('One or more items do not have enough stock on hand.');
    this.name = 'StockShortfallError';
  }
}