import type Stripe from 'stripe';
import { NextResponse } from 'next/server';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { OnlineShopOrderFinalizer } from '@/lib/onlineShop/onlineShopOrderFinalizer';
import { getStripeClient, OnlineShopStripeConnectionRepository } from '@/lib/onlineShop/stripeConnect';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';

export const runtime = 'nodejs';

async function claimEvent(businessId: string, event: Stripe.Event, intent: Stripe.PaymentIntent): Promise<boolean> {
  return runImsForBusiness(businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<any[]>(
        `SELECT id, status FROM ims_online_shop_payment_events
          WHERE business_id = ? AND provider = 'stripe' AND provider_event_id = ? LIMIT 1 FOR UPDATE`, [businessId, event.id],
      );
      if (rows[0]?.status === 'processed') { await connection.commit(); return false; }
      if (rows[0]) {
        await connection.execute("UPDATE ims_online_shop_payment_events SET status = 'received', safe_error = NULL WHERE id = ?", [rows[0].id]);
      } else {
        await connection.execute(
          `INSERT INTO ims_online_shop_payment_events
             (business_id, provider, provider_event_id, provider_payment_id, event_type, status)
           VALUES (?, 'stripe', ?, ?, ?, 'received')`, [businessId, event.id, intent.id, event.type],
        );
      }
      await connection.commit(); return true;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  });
}

async function finishEvent(businessId: string, eventId: string, error?: unknown): Promise<void> {
  await runImsForBusiness(businessId, async () => {
    const safeError = error instanceof Error ? error.message.slice(0, 500) : error ? String(error).slice(0, 500) : null;
    const connection = await getIMSPool().getConnection();
    try {
      await connection.execute(
        `UPDATE ims_online_shop_payment_events SET status = ?, safe_error = ?, processed_at = ${error ? 'NULL' : 'UTC_TIMESTAMP()'}
          WHERE business_id = ? AND provider = 'stripe' AND provider_event_id = ?`,
        [error ? 'failed' : 'processed', safeError, businessId, eventId],
      );
    } finally { connection.release(); }
  });
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 503 });
  let event: Stripe.Event;
  try { event = getStripeClient().webhooks.constructEvent(Buffer.from(await request.arrayBuffer()), signature, secret); }
  catch { return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 }); }
  if (!event.type.startsWith('payment_intent.')) return NextResponse.json({ received: true });
  const accountId = typeof event.account === 'string' ? event.account : '';
  const mapping = accountId ? await OnlineShopStripeConnectionRepository.getByAccountId(accountId) : null;
  if (!mapping) return NextResponse.json({ error: 'Connected Stripe account is not registered.' }, { status: 404 });
  const intent = event.data.object as Stripe.PaymentIntent;
  const checkoutId = intent.metadata.checkoutId ?? '';
  if (intent.metadata.businessId !== mapping.businessId || !/^[0-9a-f-]{36}$/i.test(checkoutId)) {
    await reportRuntimeIssue({ businessId: mapping.businessId, source: 'online_shop_stripe', operation: 'webhook_identity',
      title: 'Stripe payment webhook metadata did not match its connected account', context: { event_id: event.id, payment_intent_id: intent.id } }).catch(() => {});
    return NextResponse.json({ error: 'Payment metadata is invalid.' }, { status: 400 });
  }
  try {
    if (!await claimEvent(mapping.businessId, event, intent)) return NextResponse.json({ received: true, replayed: true });
    if (event.type === 'payment_intent.succeeded') {
      if (intent.currency.toUpperCase() !== 'AUD') throw new Error('Stripe payment currency is not AUD.');
      await OnlineShopOrderFinalizer.finalizePaid({ businessId: mapping.businessId, checkoutId,
        providerPaymentId: intent.id, amountCents: intent.amount_received || intent.amount });
    } else if (['payment_intent.payment_failed', 'payment_intent.canceled'].includes(event.type)) {
      await runImsForBusiness(mapping.businessId, async () => {
        const connection = await getIMSPool().getConnection();
        try {
          await connection.execute(
            `UPDATE ims_online_shop_payment_attempts SET status = ?, safe_error = ?, updated_at = CURRENT_TIMESTAMP
              WHERE business_id = ? AND provider = 'stripe' AND provider_payment_id = ?`,
            [event.type.endsWith('canceled') ? 'cancelled' : 'failed', intent.last_payment_error?.message?.slice(0, 500) ?? null, mapping.businessId, intent.id],
          );
        } finally { connection.release(); }
      });
    }
    await finishEvent(mapping.businessId, event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    await finishEvent(mapping.businessId, event.id, error).catch(() => {});
    await reportRuntimeIssue({ businessId: mapping.businessId, source: 'online_shop_stripe', operation: 'webhook_process',
      title: 'Stripe payment webhook processing failed', error, context: { event_id: event.id, payment_intent_id: intent.id },
      reference: { type: 'checkout', id: checkoutId } }).catch(() => {});
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}