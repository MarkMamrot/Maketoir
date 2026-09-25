import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
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

async function getShopify(businessId: string, channelInstanceId: string): Promise<ShopifyService> {
  const context = await getShopifyOperationContext({ businessId, channelInstanceId });
  if (shopifyInstanceSettings(context.instance.settings).giftCards.mode !== 'combined') {
    throw new Error('Gift cards are disabled for the selected Shopify store.');
  }
  return new ShopifyService(context.credentials.shopDomain, context.credentials.token);
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
  const channelInstanceId = searchParams.get('channelInstanceId')?.trim() ?? '';
  if (!code) return NextResponse.json({ error: 'code is required.' }, { status: 400 });

  // ── Local IMS lookup ──────────────────────────────────────────────────────
  const rows = await imsQuery<{ id: number; code: string; balance: string; status: string; shopify_gc_id: number | null; channel_instance_id: string | null }>(
    'SELECT id, code, balance, status, shopify_gc_id, channel_instance_id FROM gift_cards WHERE code = ? ORDER BY id',
    [code],
  );

  if (rows.length) {
    const activeCards = rows.filter(card => card.status === 'active' && Number(card.balance) > 0);
    const selectedActiveCards = activeCards.length > 1 && channelInstanceId
      ? activeCards.filter(card => card.channel_instance_id === channelInstanceId)
      : activeCards;
    if (selectedActiveCards.length > 1 || (activeCards.length > 1 && selectedActiveCards.length !== 1)) {
      return NextResponse.json({ error: 'This code matches multiple active gift cards. Select the exact gift card before continuing.' }, { status: 409 });
    }
    const card = selectedActiveCards[0] ?? rows[0];
    if (card.status !== 'active')
      return NextResponse.json({ error: `Gift card is ${card.status}.` }, { status: 422 });
    if (Number(card.balance) <= 0)
      return NextResponse.json({ error: 'Gift card has no remaining balance.' }, { status: 422 });
    return NextResponse.json({
      id: card.id, code: card.code, balance: Number(card.balance),
      status: card.status, shopify_gc_id: card.shopify_gc_id ?? null,
      channel_instance_id: card.channel_instance_id, source: 'ims',
    });
  }

  // ── Also check for placeholder code (imported Shopify card, code not yet resolved) ──
  if (code.length >= 4) {
    const last4 = code.slice(-4);
    const placeholderRows = await imsQuery<{ id: number; code: string; balance: string; status: string; shopify_gc_id: number | null; channel_instance_id: string | null }>(
      "SELECT id, code, balance, status, shopify_gc_id, channel_instance_id FROM gift_cards WHERE code LIKE ? AND shopify_gc_id IS NOT NULL ORDER BY id LIMIT 5",
      [`SHOPIFY:%${last4}`],
    );
    if (placeholderRows.length) {
      const activeCards = placeholderRows.filter(card => card.status === 'active' && Number(card.balance) > 0);
      const selectedActiveCards = activeCards.length > 1 && channelInstanceId
        ? activeCards.filter(card => card.channel_instance_id === channelInstanceId)
        : activeCards;
      if (selectedActiveCards.length > 1 || (activeCards.length > 1 && selectedActiveCards.length !== 1)) {
        return NextResponse.json({ error: 'This code matches multiple active Shopify gift cards. Select the exact gift card before continuing.' }, { status: 409 });
      }
      // Resolve to correct card — update placeholder code to full code
      const card = selectedActiveCards[0] ?? placeholderRows[0];
      if (card.status !== 'active')
        return NextResponse.json({ error: `Gift card is ${card.status}.` }, { status: 422 });
      if (Number(card.balance) <= 0)
        return NextResponse.json({ error: 'Gift card has no remaining balance.' }, { status: 422 });
      // Upgrade placeholder to full code
      await imsExecute('UPDATE gift_cards SET code = ? WHERE id = ?', [code, card.id]).catch(() => {});
      return NextResponse.json({
        id: card.id, code, balance: Number(card.balance),
        status: card.status, shopify_gc_id: card.shopify_gc_id ?? null,
        channel_instance_id: card.channel_instance_id, source: 'ims',
      });
    }
  }

  // ── Shopify fallback (combined mode only) ─────────────────────────────────
  if (code.length >= 4) {
    if (!channelInstanceId) {
      return NextResponse.json({ error: 'Select a Shopify store to search for this gift card.' }, { status: 409 });
    }
    try {
      const shopify = await getShopify(session.businessId, channelInstanceId);
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
          id: null, code, balance, status: 'active', channel_instance_id: channelInstanceId,
          shopify_gc_id: match.id, source: 'shopify',
        });
      }
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'shopify',
        operation: 'gift_card_pos_lookup',
        title: 'POS could not look up a Shopify gift card',
        error,
        context: { channelInstanceId, code_last_four: code.slice(-4) },
      });
      return NextResponse.json({ error: 'The selected Shopify store could not be searched. Try again or choose another store.' }, { status: 502 });
    }
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
  const channelInstanceId = typeof body.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
  const amt = Number(amount);
  if (!amt || amt <= 0)
    return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });

  const inputCode = rawCode?.trim() ?? null;

  if (inputCode) {
    const dup = channelInstanceId
      ? await imsQuery('SELECT id FROM gift_cards WHERE channel_instance_id = ? AND code = ? LIMIT 1', [channelInstanceId, inputCode])
      : await imsQuery('SELECT id FROM gift_cards WHERE code = ? LIMIT 1', [inputCode]);
    if (dup.length) return NextResponse.json({ error: 'Gift card code already exists.' }, { status: 409 });
  }

  // ── Create in Shopify (combined mode) ────────────────────────────────────
  let shopifyGcId: number | null = null;
  let shopifyCode: string | null = null;
  let expiresOn:   string | null = null;
  let currency                   = 'AUD';

  if (channelInstanceId) {
    let shopify: ShopifyService | null = null;
    try {
      shopify = await getShopify(session.businessId, channelInstanceId);
      const gc = await shopify.createGiftCard({
        initial_value: amt,
        ...(inputCode ? { code: inputCode } : {}),
        ...(notes ? { note: notes } : {}),
      });
      shopifyGcId = gc.id;
      shopifyCode = gc.code;
      expiresOn   = gc.expires_on ?? null;
      currency    = gc.currency ?? 'AUD';
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
        await reportRuntimeIssue({
          businessId: session.businessId,
          source: 'shopify',
          operation: 'gift_card_pos_issue',
          title: 'POS could not create Shopify gift card',
          error: e,
          context: { channelInstanceId, pos_sale_id: pos_sale_id ?? null, amount: amt },
          reference: pos_sale_id ? { type: 'pos_sale', id: pos_sale_id } : undefined,
        });
        return NextResponse.json({ error: 'The gift card could not be created in the selected Shopify store.' }, { status: 502 });
      }
    }
  }

  const finalCode = inputCode ?? shopifyCode;
  if (!finalCode)
    return NextResponse.json({ error: 'Could not generate a gift card code. Try again.' }, { status: 500 });

  const result = await imsExecute(
    `INSERT INTO gift_cards
       (channel_instance_id, shopify_gc_id, code, initial_balance, balance, status, currency, expires_on, order_id, recipient_email, notes)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [shopifyGcId ? channelInstanceId : null, shopifyGcId, finalCode, amt, amt, currency, expiresOn,
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
