import { NextResponse } from 'next/server';
import { ImsPORepo } from '@/lib/ims/ImsRepository';
import { getImsSession } from '@/lib/auth/imsSession';

export async function GET() {
  if (!await getImsSession()) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Fetch pending POs with draft or ordered status
    const allPos = await Promise.all([
      ImsPORepo.list('draft'),
      ImsPORepo.list('confirmed'),
    ]);
    const pos = [...allPos[0], ...allPos[1]];

    // For each PO, get item count
    const posWithCounts = pos.map((po) => ({
      id: po.id,
      po_number: po.po_number,
      supplier_name: po.supplier_name || 'Unknown',
      location_name: po.location_name || 'Unknown',
      status: po.status,
      expected_date: po.expected_date,
      order_date: po.order_date,
      // We'll fetch actual item count in a moment
    }));

    // Get items for each PO to count them (or we could count in separate query)
    // For now, we'll do a batch query to get item counts
    const imsQuery = (await import('@/services/IMSMySQLService')).imsQuery;
    const itemCounts = await imsQuery<{ po_id: number; item_count: number }>(
      `SELECT po_id, COUNT(*) as item_count FROM ims_purchase_order_items GROUP BY po_id`,
      []
    );
    const countMap = new Map(itemCounts.map((c) => [c.po_id, c.item_count]));

    const result = posWithCounts.map((po) => ({
      ...po,
      item_count: countMap.get(po.id) || 0,
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
