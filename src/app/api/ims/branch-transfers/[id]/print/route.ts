import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { imsQuery } from '@/services/IMSMySQLService';


export interface BTPrintItem {
  variant_id: string;
  sku: string | null;
  barcode: string | null;
  product_name: string;
  brand: string | null;
  variant_label: string | null;
  from_zone: string | null;   // source location stock zone
  from_bin:  string | null;   // source location stock bin
  to_zone:   string | null;   // destination location stock zone
  to_bin:    string | null;   // destination location stock bin
  qty_sent: number;
  wh_qty: number;       // warehouse gross qty_on_hand (SOH in Warehouse)
  wh_available: number; // warehouse net available (SOH - committed)
  branch_soh: number;   // destination branch qty_on_hand
  to_location_name: string;
}

export interface BTPrintData {
  id: number;
  transfer_number: string;
  transfer_date: string;
  from_location_name: string;
  to_location_name: string;
  notes: string | null;
  items: BTPrintItem[];
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (!await getImsSession()) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const id = Number(params.id);

    const btRows = await imsQuery<{
      id: number;
      transfer_number: string;
      transfer_date: string;
      from_location_id: number;
      to_location_id: number;
      from_location_name: string;
      to_location_name: string;
      notes: string | null;
    }>(
      `SELECT bt.id, bt.transfer_number, bt.transfer_date, bt.from_location_id, bt.to_location_id, bt.notes,
              fl.name AS from_location_name, tl.name AS to_location_name
       FROM ims_branch_transfers bt
       JOIN ims_locations fl ON fl.id = bt.from_location_id
       JOIN ims_locations tl ON tl.id = bt.to_location_id
       WHERE bt.id = ?`,
      [id]
    );

    if (!btRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const bt = btRows[0];

    const items = await imsQuery<BTPrintItem>(
      `SELECT
         bti.variant_id,
         v.sku,
         v.barcode,
         p.name  AS product_name,
         p.brand AS brand,
         NULLIF(TRIM(CONCAT_WS(' / ',
           NULLIF(TRIM(COALESCE(v.option1_value,'')), ''),
           NULLIF(TRIM(COALESCE(v.option2_value,'')), ''),
           NULLIF(TRIM(COALESCE(v.option3_value,'')), '')
         )), '') AS variant_label,
         whs.zone AS from_zone,
         whs.bin  AS from_bin,
         brs.zone AS to_zone,
         brs.bin  AS to_bin,
         bti.qty_sent,
         COALESCE(whs.qty_on_hand, 0)                                                          AS wh_qty,
         GREATEST(0, COALESCE(whs.qty_on_hand, 0) - COALESCE(whs.qty_committed, 0))           AS wh_available,
         COALESCE(brs.qty_on_hand, 0)                                                          AS branch_soh,
         tl.name AS to_location_name
       FROM ims_branch_transfer_items bti
       JOIN ims_product_variants v  ON v.variant_id = bti.variant_id
       JOIN ims_products p          ON p.product_id = v.product_id
       LEFT JOIN ims_stock whs      ON whs.variant_id = bti.variant_id AND whs.location_id = ?
       LEFT JOIN ims_stock brs      ON brs.variant_id = bti.variant_id AND brs.location_id = ?
       JOIN ims_locations tl        ON tl.id = ?
       WHERE bti.transfer_id = ?
       ORDER BY
         COALESCE(NULLIF(TRIM(whs.zone),''), '~~~'),
         COALESCE(NULLIF(TRIM(whs.bin),''),  '~~~'),
         COALESCE(NULLIF(TRIM(p.brand),''), '~~~'),
         p.name`,
      [bt.from_location_id, bt.to_location_id, bt.to_location_id, id]
    );

    return NextResponse.json({ ...bt, items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
