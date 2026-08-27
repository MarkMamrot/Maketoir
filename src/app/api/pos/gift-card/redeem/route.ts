import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { ShopifyService } from '@/services/ShopifyService';
import { syncGiftCardRedemptionReclass } from '@/services/XeroSyncService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

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
// Combined mode debits the same Shopify card and preserves its provider transaction history.
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
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'shopify',
        operation: 'gift_card_pos_import',
        title: 'POS could not import Shopify gift card',
        error: e,
        context: { pos_sale_id: pos_sale_id ?? null, code_last_four: code.slice(-4) },
        reference: pos_sale_id ? { type: 'pos_sale', id: pos_sale_id } : undefined,
      });
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
  const redemptionIdempotencyKey = pos_sale_id ? `pos-gift-card-redeem:${pos_sale_id}:${card.id}` : null;

  if (redemptionIdempotencyKey) {
    const existingTransactions = await imsQuery<{
      balance_after: string | number;
      sync_state: string;
    }>(
      'SELECT balance_after, sync_state FROM gift_card_transactions WHERE idempotency_key = ? LIMIT 1',
      [redemptionIdempotencyKey],
    );
    if (existingTransactions.length) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        balance_after: Number(existingTransactions[0].balance_after),
        status: Number(existingTransactions[0].balance_after) <= 0 ? 'redeemed' : 'active',
        shopify_synced: existingTransactions[0].sync_state === 'synced'
          ? true
          : existingTransactions[0].sync_state === 'error' ? false : null,
        xero_synced: null,
        xero_warning: null,
      });
    }
  }

  // ── Shopify sync (combined mode) ──────────────────────────────────────────
  let shopifySynced: boolean | null = null; // null = not applicable (non-combined mode)
  let shopifyTransactionId: string | null = null;
  let shopifyProcessedAt: string | null = null;
  let shopifyBalanceAfter: number | null = null;
  let shopifySyncError: string | null = null;

  if (gcMode === 'combined' && card.shopify_gc_id) {
    shopifySynced = false; // will be set to true only on full success
    try {
      const shopify = await getShopify(session.businessId);
      if (shopify) {
        const providerResult = await shopify.giftCardDebit({
          giftCardId: card.shopify_gc_id,
          amount: actualDebit,
          note: pos_sale_id ? `Solvantis POS sale ${pos_sale_id}` : 'Solvantis POS redemption',
        });
        shopifyTransactionId = providerResult.transactionId;
        shopifyProcessedAt = providerResult.processedAt;
        shopifyBalanceAfter = providerResult.balance;
        shopifySynced = true;
      }
    } catch (e: any) {
      // Shopify sync failed — still complete the IMS debit (sale already committed), but warn caller
      console.error('[POS gift-card/redeem] Shopify sync failed:', e.message, {
        card_id:       card.id,
        shopify_gc_id: card.shopify_gc_id,
        newBalance,
      });
      shopifySyncError = e?.message ?? String(e);
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'shopify',
        operation: 'gift_card_pos_redeem',
        title: 'POS gift-card redemption did not sync to Shopify',
        error: e,
        context: {
          card_id: card.id,
          shopify_gc_id: card.shopify_gc_id,
          pos_sale_id: pos_sale_id ?? null,
          balance_after: newBalance,
        },
        reference: { type: 'gift_card', id: card.id },
      });
    }
  }

  // ── Debit IMS ─────────────────────────────────────────────────────────────
  const reconciliationState = shopifySynced === false ? 'error' : shopifySynced === true ? 'matched' : 'local_only';
  await imsExecute(
    `UPDATE gift_cards
     SET balance = ?, status = ?, last_used_at = NOW(),
         order_id = COALESCE(order_id, ?),
         shopify_observed_balance = COALESCE(?, shopify_observed_balance),
         reconciliation_state = ?, reconciliation_reason = ?,
         last_reconciled_at = IF(? IS NULL, last_reconciled_at, NOW())
     WHERE id = ?`,
    [
      newBalance, newStatus, pos_sale_id ? String(pos_sale_id) : null,
      shopifyBalanceAfter, reconciliationState, shopifySyncError,
      shopifyBalanceAfter, card.id,
    ],
  );

  const txnRes = await imsExecute(
    `INSERT INTO gift_card_transactions
       (card_id, type, amount, balance_after, pos_sale_id, idempotency_key, event_source,
        shopify_transaction_id, shopify_processed_at, provider_balance_after,
        sync_state, sync_error, reference_type, reference_id, notes)
     VALUES (?, 'redeem', ?, ?, ?, ?, 'pos', ?, ?, ?, ?, ?, 'pos_sale', ?, 'Redeemed at POS')`,
    [
      card.id, -actualDebit, newBalance, pos_sale_id ?? null,
      redemptionIdempotencyKey,
      shopifyTransactionId,
      shopifyProcessedAt ? shopifyProcessedAt.slice(0, 19).replace('T', ' ') : null,
      shopifyBalanceAfter,
      shopifySynced === true ? 'synced' : shopifySynced === false ? 'error' : 'local_only',
      shopifySyncError?.slice(0, 500) ?? null,
      pos_sale_id != null ? String(pos_sale_id) : null,
    ],
  );

  let xeroSynced: boolean | null = null;
  let xeroWarning: string | null = null;
  if (actualDebit > 0 && session?.businessId) {
    try {
      const txId = Number((txnRes as any)?.insertId ?? 0);
      const xeroId = await syncGiftCardRedemptionReclass({
        businessId: session.businessId,
        amount: actualDebit,
        date: new Date().toISOString().slice(0, 10),
        channel: 'pos',
        locationId: session.location_id ?? undefined,
        dedupeKey: txId > 0
          ? `gift card redeem tx ${txId}`
          : `gift card redeem pos ${card.id}|${pos_sale_id ?? 'na'}|${actualDebit.toFixed(2)}`,
        referenceId: txId > 0 ? txId : undefined,
      });
      xeroSynced = !!xeroId;
    } catch (e: any) {
      xeroWarning = e?.message ?? 'Gift card redeemed but failed to sync redemption reclass to Xero';
    }
  }

  return NextResponse.json({
    success:       true,
    balance_after: newBalance,
    status:        newStatus,
    // shopify_synced: true = Shopify updated, false = sync failed (staff should check Shopify admin), null = not in combined mode
    shopify_synced: shopifySynced,
    xero_synced: xeroSynced,
    xero_warning: xeroWarning,
  });
}
