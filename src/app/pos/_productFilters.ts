export type StockFilterProduct = {
  soh: number;
  available?: number | null;
};

export function isInStockAtLocation(product: StockFilterProduct): boolean {
  return (product.available ?? product.soh) > 0;
}