import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
import { ShopifyService } from '@/services/ShopifyService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  findUniqueUnusedShopifyGiftCard,
  isShopifyGiftCardCodeTakenError,
} from '@/lib/pos/giftCardShopifyReconciliation';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function getShopify(businessId: string): Promise<ShopifyService | null> {
  try {
    const credentials = await getShopifyAdminCredentials(businessId);
    return credentials ? new ShopifyService(credentials.shopDomain, credentials.token) : null;
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

// GET /api/pos/gift-card?code=XXXX
// Looks up locally first. If combined mode is on and not found locally,
// falls back to Shopify and resolves the placeholder code to the full code.
export async function GET(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code')?.trim();
  if (!code) return NextResponse.json({ error: 'code is required.' }, { status: 400 });

  const gcMode = await getGcMode();

  // ── Local IMS lookup ──────────────────────────────────────────────────────
  const rows = await imsQuery<{ id: number; code: string; balance: string; status: string; shopify_gc_id: number | null }>(
    'SELECT id, code, balance, status, shopify_gc_id FROM gift_cards WHERE code = ? LIMIT 1',
    [code],
  );

  if (rows.length) {
    const card = rows[0];
    if (card.status !== 'active')
      return NextResponse.json({ error: `Gift card is ${card.status}.` }, { status: 422 });
    if (Number(card.balance) <= 0)
      return NextResponse.json({ error: 'Gift card has no remaining balance.' }, { status: 422 });
    return NextResponse.json({
      id: card.id, code: card.code, balance: Number(card.balance),
      status: card.status, shopify_gc_id: card.shopify_gc_id ?? null, source: 'ims',
    });
  }

  // ── Also check for placeholder code (imported Shopify card, code not yet resolved) ──
  if (code.length >= 4) {
    const last4 = code.slice(-4);
    const placeholderRows = await imsQuery<{ id: number; code: string; balance: string; status: string; shopify_gc_id: number | null }>(
      "SELECT id, code, balance, status, shopify_gc_id FROM gift_cards WHERE code LIKE ? AND shopify_gc_id IS NOT NULL LIMIT 5",
      [`SHOPIFY:%${last4}`],
    );
    if (placeholderRows.length) {
      // Resolve to correct card — update placeholder code to full code
      const card = placeholderRows[0];
      if (card.status !== 'active')
        return NextResponse.json({ error: `Gift card is ${card.status}.` }, { status: 422 });
      if (Number(card.balance) <= 0)
        return NextResponse.json({ error: 'Gift card has no remaining balance.' }, { status: 422 });
      // Upgrade placeholder to full code
      await imsExecute('UPDATE gift_cards SET code = ? WHERE id = ?', [code, card.id]).catch(() => {});
      return NextResponse.json({
        id: card.id, code, balance: Number(card.balance),
        status: card.status, shopify_gc_id: card.shopify_gc_id ?? null, source: 'ims',
      });
    }
  }

  // ── Shopify fallback (combined mode only) ─────────────────────────────────
  if (gcMode === 'combined' && code.length >= 4) {
    try {
      const shopify = await getShopify(session.businessId);
      if (shopify) {
        const last4 = code.slice(-4);
        const candidates = await shopify.findGiftCardsByLastChars(last4);
        const match = candidates.find(c =>
          code.toLowerCase().endsWith((c.last_characters ?? '').toLowerCase())
        );
        if (match) {
          const balance = Number(match.balance);
          if (balance <= 0)
            return NextResponse.json({ error: 'Gift card has no remaining balance.' }, { status: 422 });
          return NextResponse.json({
            id: null, code, balance, status: 'active',
            shopify_gc_id: match.id, source: 'shopify',
          });
        }
      }
    } catch { /* Shopify unreachable — don't block POS */ }
  }

  return NextResponse.json({ error: 'Gift card not found.' }, { status: 404 });
}

// POST /api/pos/gift-card — issue a new gift card (sold at POS or issued on return)
// Body: { amount, code?, pos_sale_id?, recipient_email?, notes? }
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });

  const { code: rawCode, amount, pos_sale_id, recipient_email, notes } = body;
  const amt = Number(amount);
  if (!amt || amt <= 0)
    return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });

  const gcMode   = await getGcMode();
  const inputCode = rawCode?.trim() ?? null;

  if (inputCode) {
    const dup = await imsQuery('SELECT id FROM gift_cards WHERE code = ? LIMIT 1', [inputCode]);
    if (dup.length) return NextResponse.json({ error: 'Gift card code already exists.' }, { status: 409 });
  }

  // ── Create in Shopify (combined mode) ────────────────────────────────────
  let shopifyGcId: number | null = null;
  let shopifyCode: string | null = null;
  let expiresOn:   string | null = null;
  let currency                   = 'AUD';

  if (gcMode === 'combined') {
    let shopify: ShopifyService | null = null;
    try {
      shopify = await getShopify(session.businessId);
      if (shopify) {
        const gc = await shopify.createGiftCard({
          initial_value: amt,
          ...(inputCode ? { code: inputCode } : {}),
          ...(notes ? { note: notes } : {}),
        });
        shopifyGcId = gc.id;
        shopifyCode = gc.code;
        expiresOn   = gc.expires_on ?? null;
        currency    = gc.currency ?? 'AUD';
      }
    } catch (e: any) {
      let recovered = false;
      if (shopify && inputCode && isShopifyGiftCardCodeTakenError(e)) {
        try {
          const candidates = await shopify.findGiftCardsByLastChars(inputCode.slice(-4));
          const existing = findUniqueUnusedShopifyGiftCard(candidates, inputCode, amt);
          if (existing) {
            shopifyGcId = existing.id;
            expiresOn = existing.expires_on ?? null;
            currency = existing.currency ?? 'AUD';
            recovered = true;
          }
        } catch {
          // Preserve the original duplicate-code failure as the operational evidence.
        }
      }

      if (!recovered) {
        console.error('[POS gift-card] Shopify create failed:', e.message);
        await reportRuntimeIssue({
          businessId: session.businessId,
          source: 'shopify',
          operation: 'gift_card_pos_issue',
          title: 'POS could not create Shopify gift card',
          error: e,
          context: { pos_sale_id: pos_sale_id ?? null, amount: amt },
          reference: pos_sale_id ? { type: 'pos_sale', id: pos_sale_id } : undefined,
        });
      }
    }
  }

  const finalCode = inputCode ?? shopifyCode;
  if (!finalCode)
    return NextResponse.json({ error: 'Could not generate a gift card code. Try again.' }, { status: 500 });

  const result = await imsExecute(
    `INSERT INTO gift_cards
       (shopify_gc_id, code, initial_balance, balance, status, currency, expires_on, order_id, recipient_email, notes)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [shopifyGcId, finalCode, amt, amt, currency, expiresOn,
     pos_sale_id ? String(pos_sale_id) : null, recipient_email ?? null, notes ?? null],
  );
  const cardId = (result as any).insertId;

  await imsExecute(
    `INSERT INTO gift_card_transactions (card_id, type, amount, balance_after, pos_sale_id, notes)
     VALUES (?, 'issue', ?, ?, ?, 'Issued at POS')`,
    [cardId, amt, amt, pos_sale_id ?? null],
  );

  return NextResponse.json({
    id: cardId, code: finalCode, balance: amt,
    shopify_gc_id: shopifyGcId, expires_on: expiresOn,
  }, { status: 201 });
}
