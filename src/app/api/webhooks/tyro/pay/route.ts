import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getTyroPayConfig, getTyroPayRequest, parseTyroWebhookEvent, verifyTyroWebhookSignature } from '@/lib/tyro/payApi';
import { TyroPayRepository, type TyroPayRequestRecord } from '@/lib/tyro/payRepository';

export const runtime = 'nodejs';

const PAY_REQUEST_EVENTS = new Set([
  'NEW_PAY_REQUEST',
  'PAY_REQUEST_VOIDED',
  'PAY_REQUEST_FAILED',
  'PAY_REQUEST_PROCESSING',
  'PAY_REQUEST_SUCCESS',
]);

export async function POST(request: Request) {
  const signature = request.headers.get('Tyro-Connect-Signature');
  if (!signature) return NextResponse.json({ error: 'Webhook signature is required.' }, { status: 400 });
  const payload = new Uint8Array(await request.arrayBuffer());
  try {
    if (!verifyTyroWebhookSignature(payload, signature)) {
      return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 503 });
  }

  let event;
  try { event = parseTyroWebhookEvent(payload); }
  catch { return NextResponse.json({ error: 'Invalid webhook payload.' }, { status: 400 }); }

  let record: TyroPayRequestRecord | null = null;
  try {
    if (!await TyroPayRepository.claimWebhookEvent(event)) {
      return NextResponse.json({ received: true, replayed: true });
    }
    if (event.data.resource !== 'payrequest' || !PAY_REQUEST_EVENTS.has(event.type)) {
      await TyroPayRepository.finishWebhookEvent({ event, ignored: true });
      return NextResponse.json({ received: true, ignored: true });
    }

    const payment = await getTyroPayRequest(event.data.id);
    record = await TyroPayRepository.findByProviderRequestId(payment.id)
      ?? await TyroPayRepository.findByOrderId(payment.origin.orderId);
    if (!record) {
      await TyroPayRepository.finishWebhookEvent({ event, ignored: true });
      return NextResponse.json({ received: true, ignored: true });
    }
    const config = getTyroPayConfig();
    if (payment.id !== event.data.id || payment.origin.orderId !== record.orderId
      || payment.locationId !== record.locationId || payment.locationId !== config.locationId
      || payment.total.amount !== record.amountCents || payment.total.currency !== record.currencyCode) {
      throw new Error('Tyro Pay Request identity did not match its stored record.');
    }
    await TyroPayRepository.updateFromProvider({ id: record.id, tyroPayRequestId: payment.id, status: payment.status });
    await TyroPayRepository.finishWebhookEvent({ event, businessId: record.businessId });
    return NextResponse.json({ received: true });
  } catch (error) {
    await TyroPayRepository.finishWebhookEvent({ event, businessId: record?.businessId, error }).catch(() => {});
    await reportRuntimeIssue({ businessId: record?.businessId ?? '__solvantis_platform__', source: 'tyro_pay',
      operation: 'process_webhook', title: 'Tyro Pay webhook processing failed', error,
      context: { event_type: event.type, resource_type: event.data.resource, resource_id: event.data.id },
      reference: { type: 'tyro_pay_request', id: event.data.id } }).catch(() => {});
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}