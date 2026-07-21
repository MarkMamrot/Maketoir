import { NextRequest, NextResponse } from 'next/server';
import { getImportSession } from '@/app/api/ims/import/_helpers';
import { ImsStocktakeRepo } from '@/lib/ims/ImsRepository';

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await getImportSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const id = parseInt(params.id, 10);
    const st = await ImsStocktakeRepo.get(id);
    if (!st) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(st);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getImportSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (session?.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
    const id = parseInt(params.id, 10);
    const body = await req.json();

    // Update a single item's counted_qty
    if (body.action === 'update_item') {
      const { item_id, counted_qty, notes } = body;
      await ImsStocktakeRepo.updateItem(item_id, counted_qty, notes);
      return NextResponse.json({ ok: true });
    }

    // Change status
    if (body.action === 'change_status') {
      await ImsStocktakeRepo.changeStatus(id, body.status);
      return NextResponse.json({ ok: true });
    }

    // Bulk update items (array of { item_id, counted_qty, notes })
    if (body.action === 'bulk_update_items' && Array.isArray(body.items)) {
      for (const item of body.items) {
        await ImsStocktakeRepo.updateItem(item.item_id, item.counted_qty ?? null, item.notes);
      }
      return NextResponse.json({ ok: true });
    }

    // Remove a single item
    if (body.action === 'remove_item') {
      await ImsStocktakeRepo.removeItem(body.item_id);
      return NextResponse.json({ ok: true });
    }

    // Revert applied stocktake
    if (body.action === 'revert') {
      const result = await ImsStocktakeRepo.revertFromStock(id);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await getImportSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const id = parseInt(params.id, 10);
    await ImsStocktakeRepo.delete(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
