import { NextResponse } from 'next/server';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { ShopifyService } from '@/services/ShopifyService';

// POST /api/ims/shopify/sync-gift-cards
// Upserts all Shopify gift cards into IMS (matched by shopify_gc_id).
// New cards use last_characters as a code placeholder (resolved to full code on first POS scan).
// Existing cards have status, currency, expires_on, and created_at refreshed from Shopify.
// The card's code and balance in IMS are never overwritten.
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

  if (!allCards.length) return NextResponse.json({ synced: 0, errors: 0, total: 0 });

  let synced = 0;
  let errors = 0;

  for (const gc of allCards) {

    const status    = gc.disabled_at ? (Number(gc.balance) <= 0 ? 'redeemed' : 'cancelled') : 'active';
    const expiresOn = gc.expires_on ?? null;
    const balance   = Number(gc.balance ?? 0);
    const initial   = Number(gc.initial_value ?? balance);
    // Placeholder code: 'SHOPIFY:' prefix + last 4 chars — resolved to full code on first POS scan
    const codePlaceholder = `SHOPIFY:${gc.last_characters ?? gc.id}`;

    const createdAt = gc.created_at
      ? new Date(gc.created_at).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    try {
      await imsExecute(
        `INSERT INTO gift_cards
           (shopify_gc_id, shopify_line_item_id, code, initial_balance, balance, status,
            currency, expires_on, customer_id, order_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Imported from Shopify', ?)
         ON DUPLICATE KEY UPDATE
           initial_balance = IF(initial_balance IS NULL, VALUES(initial_balance), initial_balance),
           status          = VALUES(status),
           currency        = VALUES(currency),
           expires_on      = VALUES(expires_on),
           created_at      = VALUES(created_at)`,
        [
          gc.id,
          gc.line_item_id ?? null,
          codePlaceholder,
          initial, balance, status,
          gc.currency ?? 'AUD',
          expiresOn,
          gc.customer_id ? String(gc.customer_id) : null,
          gc.order_id    ? String(gc.order_id)    : null,
          createdAt,
        ],
      );
      synced++;
    } catch (e: any) {
      // IGNORE duplicate code errors (two Shopify cards with same last 4 — use gc.id as code)
      if (e.code === 'ER_DUP_ENTRY') {
        try {
          await imsExecute(
            `INSERT INTO gift_cards
               (shopify_gc_id, shopify_line_item_id, code, initial_balance, balance, status,
                currency, expires_on, customer_id, order_id, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Imported from Shopify', ?)
             ON DUPLICATE KEY UPDATE
               initial_balance = IF(initial_balance IS NULL, VALUES(initial_balance), initial_balance),
               status          = VALUES(status),
               currency        = VALUES(currency),
               expires_on      = VALUES(expires_on),
               created_at      = VALUES(created_at)`,
            [
              gc.id, gc.line_item_id ?? null,
              `SHOPIFY:ID:${gc.id}`,
              initial, balance, status,
              gc.currency ?? 'AUD', expiresOn,
              gc.customer_id ? String(gc.customer_id) : null,
              gc.order_id    ? String(gc.order_id)    : null,
              createdAt,
            ],
          );
          synced++;
        } catch { errors++; }
      } else { errors++; }
    }
  }

  return NextResponse.json({ success: true, synced, errors, total: allCards.length });
}
