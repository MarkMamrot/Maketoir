import type { ProductRow } from '@/lib/db/ProductsRepository';
import type { SaleRow } from '@/lib/db/SalesRepository';
import type { StandardizedVariant, StandardizedSaleLine } from '@/types/StandardizedData';

export function cin7ProductToVariant(row: ProductRow): StandardizedVariant {
  return {
    source_type:      'cin7',
    source_id:        row.option_id,
    parent_source_id: row.cin7_id ?? null,
    sku:              row.code,
    barcode:          row.barcode,
    name:             row.name ?? '',
    brand:            row.brand,
    category:         null,
    style_code:       row.style_code,
    option_label:     row.option_label ?? 'Default',
    cost:             row.cost,
    price:            row.retail_price,
    qty_on_hand:      row.global_soh ?? 0,
    qty_incoming:     row.global_incoming ?? 0,
    is_online:        row.online === 1,
    pack_size:        row.pack_size,
    created_date:     row.created_date ?? null,
  };
}

export function cin7SaleToLine(row: SaleRow): StandardizedSaleLine {
  return {
    source_type:   'cin7',
    source_id:     String(row.id ?? ''),
    order_ref:     row.order_id,
    date:          row.invoice_date,
    sku:           row.code,
    name:          row.name,
    qty:           row.qty,
    unit_price:    row.unit_price,
    line_total:    row.line_total,
    location_name: null,  // not available directly on SaleRow
    channel:       row.source,
  };
}
