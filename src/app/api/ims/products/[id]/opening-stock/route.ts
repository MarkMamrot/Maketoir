import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import {
  applyProductOpeningStock,
  normalizeProductOpeningStockLines,
  ProductOpeningStockError,
} from '@/lib/ims/productOpeningStock';
import { InventoryDocumentRevisionConflict } from '@/lib/ims/creditNoteStatusCommands';
import { InventoryDocumentLifecycleConflict } from '@/lib/ims/inventoryDocumentLifecycle';
import { InventoryDocumentOperationConflict } from '@/lib/ims/inventoryDocumentOperations';
import { StocktakeOperationConflict } from '@/lib/ims/stocktakes/stocktakeOperations';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

interface Context { params: { id: string } }

export async function POST(req: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const body = await req.json();
    const lines = normalizeProductOpeningStockLines(body?.lines);
    const result = await applyProductOpeningStock({
      businessId: session.businessId,
      productId: params.id,
      requestToken: String(body?.requestToken ?? ''),
      lines,
      actorId: session.userId,
      actorName: session.name ?? session.email,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ProductOpeningStockError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    const conflict = error instanceof StocktakeOperationConflict
      || error instanceof InventoryDocumentLifecycleConflict
      || error instanceof InventoryDocumentOperationConflict
      || error instanceof InventoryDocumentRevisionConflict;
    if (conflict) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'ims.products',
      operation: 'apply_opening_stock',
      title: 'Opening stock could not be applied while creating a product',
      error,
      context: { productId: params.id },
      sourceRef: params.id,
    });
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Opening stock could not be applied.' }, { status: 500 });
  }
}