import type { ImsProduct, ImsVariant, ImsStock, ImsSO, ImsSOItem } from '@/lib/ims/ImsRepository';
import type { StandardizedVariant, StandardizedSaleLine } from '@/types/StandardizedData';

export interface ImsPosSaleItem {
  id: number;
  sale_id: number;
  variant_id: string | null;
  code?: string | null;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  // joined fields added by query
  sale_date?: string;           // DATE(ps.completed_at)
  location_name?: string | null;
  sku?: string | null;          // from ims_product_variants
  product_name?: string | null; // from ims_products
}

function variantLabel(v: ImsVariant): string {
  return [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(' / ') || 'Default';
}

export function imsVariantToStandard(p: ImsProduct, v: ImsVariant, s?: ImsStock): StandardizedVariant {
  return {
    source_type:      'ims',
    source_id:        v.variant_id,
    parent_source_id: p.product_id,
    sku:              v.sku ?? null,
    barcode:          v.barcode ?? null,
    name:             p.name,
    brand:            p.brand ?? null,
    category:         p.category ?? null,
    style_code:       p.style_code ?? null,
    option_label:     variantLabel(v),
    cost:             v.cost_aud ?? null,
    price:            v.price_rrp ?? null,
    qty_on_hand:      s?.qty_on_hand ?? 0,
    qty_incoming:     s?.qty_incoming ?? 0,
    is_online:        p.is_online === 1,
    pack_size:        v.pack_size ?? null,
    created_date:     p.created_at ?? null,
  };
}

export function imsSOItemToSaleLine(item: ImsSOItem, so: ImsSO): StandardizedSaleLine {
  return {
    source_type:   'solvantis',
    source_id:     String(item.id),
    order_ref:     so.so_number,
    date:          so.order_date,
    sku:           item.sku ?? null,
    name:          item.product_name ?? null,
    qty:           item.qty_fulfilled || item.qty_ordered,
    unit_price:    item.unit_price,
    line_total:    item.line_total,
    location_name: so.location_name ?? null,
    channel:       'ims',
  };
}

export function imsPOSSaleToLine(item: ImsPosSaleItem): StandardizedSaleLine {
  return {
    source_type:   'solvantis',
    source_id:     `pos-${item.id}`,
    order_ref:     `POS-${item.sale_id}`,
    date:          item.sale_date ?? '',
    sku:           item.sku ?? item.code ?? null,
    name:          item.product_name ?? item.name ?? null,
    qty:           Number(item.qty),
    unit_price:    Number(item.unit_price),
    line_total:    Number(item.line_total),
    location_name: item.location_name ?? null,
    channel:       'pos',
  };
}
