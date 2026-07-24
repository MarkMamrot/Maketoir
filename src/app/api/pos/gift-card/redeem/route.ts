import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { ShopifyService } from '@/services/ShopifyService';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function getShopify(businessId: string): Promise<ShopifyService | null> {
  try {
    const conn = await ConnectionsRepository.get(businessId);
    if (!conn?.shopify_shop_id || !conn?.shopify_access_token) return null;
    let token = conn.shopify_access_token;
    try { token = decrypt(token); } catch { /* unencrypted */ }
    return new ShopifyService(conn.shopify_shop_id, token);
  } catch { return null; }
}

async function getGcMode(): Promise<string> {
  try {
    const rows = await imsQuery<{ value: string }>(
      "SELECT value FROM ims_settings WHERE `key` = 'shopify_gc_mode' LIMIT 1",
    );
    return rows[0]?.value ?? 'off';
  } catch { return 'off'; }
}

// POST /api/pos/gift-card/redeem
// Body: { code, amount, pos_sale_id? }
// combined mode: partial redemption = disable old Shopify card + issue new one with remaining balance.
// Full redemption: disable Shopify card.
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const { code, amount, pos_sale_id } = body;
  if (!code || typeof code !== 'string')
    return NextResponse.json({ error: 'code is required.' }, { status: 400 });
  const debitAmt = Number(amount);
  if (!debitAmt || debitAmt <= 0)
    return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });

  const gcMode = await getGcMode();

  // ── Resolve card — IMS first ──────────────────────────────────────────────
  let card: { id: number; balance: number; status: string; shopify_gc_id: number | null } | null = null;

  const imsRows = await imsQuery<{ id: number; balance: string; status: string; shopify_gc_id: number | null }>(
    'SELECT id, balance, status, shopify_gc_id FROM gift_cards WHERE code = ? LIMIT 1',
    [code.trim()],
  );

  if (imsRows.length) {
    card = { id: imsRows[0].id, balance: Number(imsRows[0].balance), status: imsRows[0].status, shopify_gc_id: imsRows[0].shopify_gc_id ?? null };
  } else if (code.length >= 4 && gcMode === 'combined') {
    // Shopify fallback — online-issued card used at POS for the first time
    try {
      const shopify = await getShopify(session.businessId);
      if (shopify) {
        const last4 = code.slice(-4);
        const candidates = await shopify.findGiftCardsByLastChars(last4);
        const match = candidates.find(c =>
          code.toLowerCase().endsWith((c.last_characters ?? '').toLowerCase())
        );
        if (match) {
          const ins = await imsExecute(
            `INSERT INTO gift_cards
               (shopify_gc_id, code, initial_balance, balance, status, currency, expires_on, order_id, notes)
             VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'Imported from Shopify on first POS redemption')`,
            [match.id, code.trim(), Number(match.initial_value), Number(match.balance),
             match.currency ?? 'AUD', match.expires_on ?? null,
             match.order_id ? String(match.order_id) : null],
          );
          card = { id: (ins as any).insertId, balance: Number(match.balance), status: 'active', shopify_gc_id: match.id };
        }
      }
    } catch (e: any) {
      console.error('[POS gift-card/redeem] Shopify fallback failed:', e.message);
    }
  }

  if (!card) return NextResponse.json({ error: 'Gift card not found.' }, { status: 404 });
  if (card.status !== 'active')
    return NextResponse.json({ error: `Gift card is ${card.status}.` }, { status: 422 });
  if (card.balance <= 0)
    return NextResponse.json({ error: 'Gift card has no remaining balance.' }, { status: 422 });

  const actualDebit = Math.min(debitAmt, card.balance);
  const newBalance  = Math.max(0, Math.round((card.balance - actualDebit) * 100) / 100);
  const newStatus   = newBalance <= 0 ? 'redeemed' : 'active';

  // ── Shopify sync (combined mode) ──────────────────────────────────────────
  let newCode: string | null = null;
  let newShopifyGcId: number | null = null;
  let shopifySynced: boolean | null = null; // null = not applicable (non-combined mode)

  if (gcMode === 'combined' && card.shopify_gc_id) {
    shopifySynced = false; // will be set to true only on full success
    try {
      const shopify = await getShopify(session.businessId);
      if (shopify) {
        // Disable the old card. Returns false if already disabled (previous partial attempt),
        // which is treated as no-op success so replacement creation can still proceed.
        const freshlyDisabled = await shopify.disableGiftCard(card.shopify_gc_id);
        if (!freshlyDisabled) {
          console.warn(`[POS gift-card/redeem] GC shopify_id=${card.shopify_gc_id} was already disabled — continuing with replacement creation`, { card_id: card.id });
        }

        if (newBalance > 0) {
          // Issue a replacement card in Shopify with the remaining balance
          const replacement = await shopify.createGiftCard({
            initial_value: newBalance,
            note: `Replacement for redeemed card (${actualDebit.toFixed(2)} used at POS)`,
          });
          newCode        = replacement.code;
          newShopifyGcId = replacement.id;
        }
        shopifySynced = true;
      }
    } catch (e: any) {
      // Shopify sync failed — still complete the IMS debit (sale already committed), but warn caller
      console.error('[POS gift-card/redeem] Shopify sync failed:', e.message, {
        card_id:       card.id,
        shopify_gc_id: card.shopify_gc_id,
        newBalance,
      });
    }
  }

  // ── Debit IMS ─────────────────────────────────────────────────────────────
  // If Shopify issued a replacement, update the code + shopify_gc_id too
  if (newCode && newShopifyGcId) {
    await imsExecute(
      `UPDATE gift_cards
       SET balance = ?, status = ?, last_used_at = NOW(),
           code = ?, shopify_gc_id = ?,
           order_id = COALESCE(order_id, ?)
       WHERE id = ?`,
      [newBalance, newStatus, newCode, newShopifyGcId, pos_sale_id ? String(pos_sale_id) : null, card.id],
    );
  } else {
    await imsExecute(
      `UPDATE gift_cards
       SET balance = ?, status = ?, last_used_at = NOW(),
           order_id = COALESCE(order_id, ?)
       WHERE id = ?`,
      [newBalance, newStatus, pos_sale_id ? String(pos_sale_id) : null, card.id],
    );
  }

  await imsExecute(
    `INSERT INTO gift_card_transactions (card_id, type, amount, balance_after, pos_sale_id)
     VALUES (?, 'redeem', ?, ?, ?)`,
    [card.id, -actualDebit, newBalance, pos_sale_id ?? null],
  );

  return NextResponse.json({
    success:       true,
    balance_after: newBalance,
    status:        newStatus,
    // shopify_synced: true = Shopify updated, false = sync failed (staff should check Shopify admin), null = not in combined mode
    shopify_synced: shopifySynced,
    // new_code is set when combined mode issued a replacement card — cashier must give this to customer
    ...(newCode ? { new_code: newCode } : {}),
  });
}
