import { NextResponse } from 'next/server';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { ShopifyService } from '@/services/ShopifyService';

// POST /api/ims/shopify/sync-gift-cards
// Imports all Shopify gift cards not yet in IMS (matched by shopify_gc_id).
// Cards imported this way use last_characters as a code placeholder.
// The full code is resolved and stored the first time the card is used at POS.
export async function POST() {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const businessId = session.businessId;

  const conn = await ConnectionsRepository.get(businessId);
  if (!conn?.shopify_shop_id || !conn?.shopify_access_token)
    return NextResponse.json({ error: 'Shopify credentials not configured.' }, { status: 400 });

  let token = conn.shopify_access_token;
  try { token = decrypt(token); } catch { /* unencrypted */ }
  const shopify = new ShopifyService(conn.shopify_shop_id, token);

  // Fetch all enabled + disabled cards from Shopify
  let allCards: any[] = [];
  try {
    const [enabled, disabled] = await Promise.all([
      shopify.getAllGiftCards('enabled'),
      shopify.getAllGiftCards('disabled'),
    ]);
    allCards = [...enabled, ...disabled];
  } catch (e: any) {
    return NextResponse.json({ error: `Shopify API error: ${e.message}` }, { status: 502 });
  }

  if (!allCards.length) return NextResponse.json({ imported: 0, skipped: 0, total: 0 });

  // Load existing shopify_gc_ids to skip duplicates
  const existingRows = await imsQuery<{ shopify_gc_id: number }>(
    'SELECT shopify_gc_id FROM gift_cards WHERE shopify_gc_id IS NOT NULL',
  );
  const existingIds = new Set(existingRows.map(r => r.shopify_gc_id));

  let imported = 0;
  let skipped  = 0;

  for (const gc of allCards) {
    if (existingIds.has(gc.id)) { skipped++; continue; }

    const status    = gc.disabled_at ? (Number(gc.balance) <= 0 ? 'redeemed' : 'cancelled') : 'active';
    const expiresOn = gc.expires_on ?? null;
    const balance   = Number(gc.balance ?? 0);
    const initial   = Number(gc.initial_value ?? balance);
    // Placeholder code: 'SHOPIFY:' prefix + last 4 chars — resolved to full code on first POS scan
    const codePlaceholder = `SHOPIFY:${gc.last_characters ?? gc.id}`;

    try {
      await imsExecute(
        `INSERT IGNORE INTO gift_cards
           (shopify_gc_id, shopify_line_item_id, code, initial_balance, balance, status,
            currency, expires_on, customer_id, order_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Imported from Shopify', ?)`,
        [
          gc.id,
          gc.line_item_id ?? null,
          codePlaceholder,
          initial, balance, status,
          gc.currency ?? 'AUD',
          expiresOn,
          gc.customer_id ? String(gc.customer_id) : null,
          gc.order_id    ? String(gc.order_id)    : null,
          // Use Shopify's original created_at (convert to UTC for MySQL)
          gc.created_at ? new Date(gc.created_at).toISOString().slice(0, 19).replace('T', ' ') : null,
        ],
      );
      existingIds.add(gc.id);
      imported++;
    } catch (e: any) {
      // IGNORE duplicate code errors (two Shopify cards with same last 4 — use gc.id as code)
      if (e.code === 'ER_DUP_ENTRY') {
        try {
          await imsExecute(
            `INSERT IGNORE INTO gift_cards
               (shopify_gc_id, shopify_line_item_id, code, initial_balance, balance, status,
                currency, expires_on, customer_id, order_id, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Imported from Shopify', ?)`,
            [
              gc.id, gc.line_item_id ?? null,
              `SHOPIFY:ID:${gc.id}`,
              initial, balance, status,
              gc.currency ?? 'AUD', expiresOn,
              gc.customer_id ? String(gc.customer_id) : null,
              gc.order_id    ? String(gc.order_id)    : null,
              gc.created_at ? new Date(gc.created_at).toISOString().slice(0, 19).replace('T', ' ') : null,
            ],
          );
          existingIds.add(gc.id);
          imported++;
        } catch { skipped++; }
      } else { skipped++; }
    }
  }

  return NextResponse.json({ success: true, imported, skipped, total: allCards.length });
}
