import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ProductsRepository } from '@/lib/db/ProductsRepository';
import { resolveInventorySystemId } from '@/lib/cin7Helpers';
import { getInventorySource } from '@/lib/dataProvider';
import { imsQuery, getIMSPool } from '@/services/IMSMySQLService';

/**
 * POST /api/inventory/save-volumes
 * Body: { databaseId: string; updates: Array<{ optionId: string; volume: number }> }
 *
 * Persists per-variant volume ratings.
 * Cin7:  writes to `products.volume` in the marketoir DB.
 * IMS:   writes to `ims_product_variants.volume` (column is auto-added on first use).
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const body = await req.json();
  const databaseId: string = String(body?.databaseId ?? '').trim();
  const updates: { optionId: string; volume: number }[] = Array.isArray(body?.updates) ? body.updates : [];

  if (!databaseId) {
    return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  }
  if (updates.length === 0) {
    return NextResponse.json({ success: false, error: 'No updates provided.' }, { status: 400 });
  }

  const source = await getInventorySource(databaseId).catch(() => 'cin7');
  const errors: string[] = [];
  let savedCount = 0;

  if (source === 'solvantis') {
    // Ensure the volume column exists in the IMS DB
    const pool = getIMSPool();
    await pool.query(
      `ALTER TABLE ims_product_variants ADD COLUMN IF NOT EXISTS volume TINYINT UNSIGNED NULL DEFAULT NULL`
    );

    for (const { optionId, volume } of updates) {
      if (!optionId) continue;
      try {
        await pool.query(
          `UPDATE ims_product_variants SET volume = ? WHERE variant_id = ?`,
          [Math.min(10, Math.max(1, Math.round(volume))), optionId],
        );
        savedCount++;
      } catch (e: any) {
        errors.push(`${optionId}: ${e.message}`);
      }
    }
  } else {
    const inventorySystemId = await resolveInventorySystemId(databaseId);

    for (const { optionId, volume } of updates) {
      if (!optionId) continue;
      try {
        await ProductsRepository.updateVolume(inventorySystemId, optionId, volume);
        savedCount++;
      } catch (e: any) {
        errors.push(`${optionId}: ${e.message}`);
      }
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    saved: savedCount,
    errors,
    message: errors.length === 0
      ? `Saved ${savedCount} volume${savedCount !== 1 ? 's' : ''}.`
      : `Saved ${savedCount} volume${savedCount !== 1 ? 's' : ''} with ${errors.length} error${errors.length !== 1 ? 's' : ''}.`,
  });
}

