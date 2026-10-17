import { recoverShopifyOrderRefund, type ShopifyOrderRefundInput } from '@/lib/channels/shopifyOrderRefund';
import { getShopifyOrderCustomerId } from '@/lib/ims/shopifyOrderCustomer';
import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { calculateShopifyEligibleSpend } from '@/lib/loyalty/calculations';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { ShopifyLoyaltyService } from '@/lib/loyalty/ShopifyLoyaltyService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { toBusinessDate } from '@/lib/shopifyDate';
import { parseShopifyRefund } from '@/lib/shopifyRefund';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';

export type ShopifyRecoveryEffectResult =
  | { status: 'completed' }
  | { status: 'blocked' | 'retry'; reason: string };

type Identity = { businessId: string; channelInstanceId: string };

function validIdentity(input: Identity): boolean {
  return Boolean(input.businessId.trim() && input.channelInstanceId.trim());
}

function numericId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? id : null;
}

async function failed(input: Identity, operation: string, referenceId: string): Promise<ShopifyRecoveryEffectResult> {
  // Provider/domain errors may contain response payloads. Persist only a fixed failure code.
  await reportRuntimeIssue({
    businessId: input.businessId, source: 'shopify_recovery', operation,
    title: 'Shopify downstream recovery is unfinished',
    error: new Error('Shopify downstream effect failed; retry is required.'),
    context: { channelInstanceId: input.channelInstanceId },
    reference: { type: 'shopify_order', id: referenceId },
  });
  return { status: 'retry', reason: operation };
}

async function projectAccount(input: Identity, accountId: number): Promise<ShopifyRecoveryEffectResult> {
  const accounts = await imsQuery<{ contact_id: number }>(
    'SELECT contact_id FROM loyalty_accounts WHERE business_id = ? AND id = ? LIMIT 1',
    [input.businessId, accountId],
  );
  const contactId = Number(accounts[0]?.contact_id);
  if (!Number.isSafeInteger(contactId) || contactId <= 0) {
    return { status: 'blocked', reason: 'loyalty_account_missing' };
  }
  const projection = await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({
    businessId: input.businessId, channelInstanceId: input.channelInstanceId, contactId,
  });
  if (projection.status === 'synced') return { status: 'completed' };
  return projection.status === 'failed'
    ? { status: 'retry', reason: 'loyalty_projection_failed' }
    : { status: 'blocked', reason: `loyalty_projection_${projection.reason}` };
}

// Caller owns tenant callback scope, snapshot fencing and the already-committed local receipt.
export async function recoverShopifyPaidOrderEffects(input: Identity & {
  order: Record<string, unknown>;
}): Promise<ShopifyRecoveryEffectResult> {
  const orderId = numericId(input.order.id);
  if (!validIdentity(input) || !orderId) return { status: 'blocked', reason: 'invalid_identity' };
  try {
    const shopifyCustomerId = getShopifyOrderCustomerId(input.order);
    const discountCodes = Array.isArray(input.order.discount_codes)
      ? input.order.discount_codes.map(discount => String(discount?.code ?? '')) : [];
    if (shopifyCustomerId && discountCodes.length) {
      await ShopifyLoyaltyService.markPaidOrderRedemptionsUsed({
        businessId: input.businessId, channelInstanceId: input.channelInstanceId,
        shopifyOrderId: orderId, shopifyCustomerId, discountCodes,
      });
    }
    const eligibleSpend = calculateShopifyEligibleSpend({
      subtotalPrice: Number(input.order.subtotal_price ?? 0),
      lineItems: (Array.isArray(input.order.line_items) ? input.order.line_items : []).map(item => ({
        quantity: Number(item.quantity ?? 0), price: item.price ?? 0, giftCard: Boolean(item.gift_card),
        discountAllocations: (Array.isArray(item.discount_allocations) ? item.discount_allocations : [])
          .map((allocation: { amount?: string | number } | null) => ({ amount: allocation?.amount ?? 0 })),
      })),
    });
    const paidAt = input.order.processed_at ?? input.order.updated_at ?? input.order.created_at;
    const award = await ShopifyLoyaltyService.awardPaidOrder({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId,
      shopifyOrderId: orderId,
      paidDate: toBusinessDate(paidAt == null ? null : String(paidAt)),
      eligibleSpend, deferMetafieldSync: true,
      allowRefundedOrder: ['partially_refunded', 'refunded'].includes(String(input.order.financial_status ?? '').toLowerCase()),
    });
    if (award.status === 'skipped') {
      return award.reason === 'order_not_found'
        ? { status: 'blocked', reason: 'local_order_missing' } : { status: 'completed' };
    }
    // Legacy award replay deliberately skips projection; recovery must retry it independently.
    const projection = await projectAccount(input, award.mutation.accountId);
    if (projection.status === 'retry') return failed(input, projection.reason, orderId);
    return projection;
  } catch {
    return failed(input, 'paid_order_effects_failed', orderId);
  }
}

export async function recoverShopifyRefundDownstreamEffects(input: ShopifyOrderRefundInput & {
  creditNoteId: number;
}): Promise<ShopifyRecoveryEffectResult> {
  const orderId = numericId(input.refund.order_id);
  const refundId = numericId(input.refund.id);
  if (!validIdentity(input) || !orderId || !refundId
    || !Number.isSafeInteger(input.creditNoteId) || input.creditNoteId <= 0) {
    return { status: 'blocked', reason: 'invalid_identity' };
  }
  try {
    const refund = parseShopifyRefund(input.refund);
    const notes = await imsQuery<{ id: number; total_amount: number | string; tax_amount: number | string }>(
      `SELECT cn.id, cn.total_amount, cn.tax_amount
         FROM ims_credit_notes cn
         JOIN ims_sales_orders so ON so.id = cn.so_id AND so.business_id = cn.business_id
        WHERE cn.business_id = ? AND cn.id = ? AND cn.source = 'shopify' AND cn.status = 'complete'
          AND so.sales_channel = 'shopify' AND so.channel_instance_id = ? AND so.external_order_id = ?
          AND ((cn.channel_instance_id = ? AND cn.external_refund_id = ?)
            OR (cn.channel_instance_id IS NULL AND cn.shopify_refund_id = ?)) LIMIT 1`,
      [input.businessId, input.creditNoteId, input.channelInstanceId, orderId,
        input.channelInstanceId, refundId, refundId],
    );
    const note = notes[0];
    if (!note || Number(note.id) !== input.creditNoteId
      || Math.round(Number(note.total_amount) * 100) !== Math.round(refund.amount * 100)
      || Math.round(Number(note.tax_amount) * 100) !== Math.round(refund.taxAmount * 100)) {
      return { status: 'blocked', reason: 'completed_credit_note_unverified' };
    }
    const result = await recoverShopifyOrderRefund({
      businessId: input.businessId, channelInstanceId: input.channelInstanceId, refund: input.refund,
    });
    if (result.creditNoteId !== input.creditNoteId || result.outcome !== 'duplicate') {
      return { status: 'blocked', reason: 'completed_credit_note_changed' };
    }
    // The existing refund owner throws on failed projections but treats skips as success.
    // Verify that an existing reversal's projection really completed, including replay.
    const reversal = await LoyaltyRepository.getMutationByIdempotencyKey(
      input.businessId, `shopify:${input.channelInstanceId}:refund:${refundId}:earn`,
    );
    if (reversal) {
      const projection = await projectAccount(input, reversal.accountId);
      if (projection.status === 'retry') return failed(input, projection.reason, orderId);
      if (projection.status !== 'completed') return projection;
    }
    if (result.accounting.status === 'not_required') return { status: 'completed' };
    if (result.accounting.status === 'blocked') {
      return { status: 'blocked', reason: `accounting_${result.accounting.reason}` };
    }
    if (result.accounting.status === 'queued') return { status: 'retry', reason: 'accounting_queued' };
    const evidence = await imsQuery<{ id: number }>(
      `SELECT cn.id FROM ims_credit_notes cn
        WHERE cn.business_id = ? AND cn.id = ? AND cn.status = 'complete'
          AND cn.xero_credit_note_id = ? AND cn.xero_sync_status = 'synced' LIMIT 1`,
      [input.businessId, input.creditNoteId, result.accounting.xeroId],
    );
    if (!evidence.length) return { status: 'blocked', reason: 'accounting_completion_unverified' };
    const posting = await query<{ id: number }>(
      `SELECT id FROM xero_sync_log WHERE BINARY business_id = BINARY ? AND reference_id = ?
        AND sync_type = 'cn_credit_note' AND xero_id = ?
        AND status = 'success' AND xero_state = 'AUTHORISED' LIMIT 1`,
      [input.businessId, input.creditNoteId, result.accounting.xeroId],
    );
    return posting.length ? { status: 'completed' }
      : { status: 'blocked', reason: 'accounting_completion_unverified' };
  } catch {
    return failed(input, 'refund_downstream_effects_failed', orderId);
  }
}
