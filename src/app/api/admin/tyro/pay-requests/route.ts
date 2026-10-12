import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { createTyroPayRequest, getTyroPayConfig, getTyroPayRequest } from '@/lib/tyro/payApi';
import { TyroPayRepository } from '@/lib/tyro/payRepository';

export const runtime = 'nodejs';

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function assertSandbox(): ReturnType<typeof getTyroPayConfig> {
  const config = getTyroPayConfig();
  if (config.environment !== 'sandbox') throw new Error('Tyro certification endpoints require sandbox mode.');
  return config;
}

export async function GET(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    assertSandbox();
    const localId = new URL(request.url).searchParams.get('id')?.trim() ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(localId)) return noStore({ error: 'A valid certification request ID is required.' }, 400);
    const local = await TyroPayRepository.findById(localId);
    if (!local || local.businessId !== auth.user.businessId || !local.tyroPayRequestId) {
      return noStore({ error: 'Certification Pay Request was not found.' }, 404);
    }
    const payment = await getTyroPayRequest(local.tyroPayRequestId);
    if (payment.origin.orderId !== local.orderId || payment.locationId !== local.locationId
      || payment.total.amount !== local.amountCents || payment.total.currency !== 'AUD') {
      throw new Error('Tyro Pay Request identity did not match its certification record.');
    }
    await TyroPayRepository.updateFromProvider({ id: local.id, tyroPayRequestId: payment.id, status: payment.status });
    return noStore({ id: local.id, payRequestId: payment.id, status: payment.status,
      amountCents: payment.total.amount, currency: payment.total.currency });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'tyro_pay', operation: 'retrieve_certification_payment',
      title: 'Tyro certification payment status could not be retrieved', error }).catch(() => {});
    return noStore({ error: 'Tyro payment status could not be retrieved.' }, 500);
  }
}

export async function POST(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null);
  const amountCents = Number(body?.amountCents);
  const reference = typeof body?.reference === 'string' ? body.reference.trim().slice(0, 191) : '';
  const statementDescriptor = typeof body?.statementDescriptor === 'string' ? body.statementDescriptor.trim() : '';
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 1_000_000) {
    return noStore({ error: 'Amount must be between 1 and 1,000,000 cents.' }, 400);
  }
  if (statementDescriptor.length > 21) return noStore({ error: 'Statement descriptor cannot exceed 21 characters.' }, 400);

  const id = randomUUID();
  const orderId = `SV-CERT-${id}`;
  try {
    const config = assertSandbox();
    await TyroPayRepository.createPending({ id, businessId: auth.user.businessId, purpose: 'certification',
      sourceReference: reference || undefined, orderId, locationId: config.locationId, amountCents,
      createdByUserId: auth.user.userId });
    const payment = await createTyroPayRequest({ orderId, orderReference: reference || 'Tyro certification', amountCents,
      statementDescriptor: statementDescriptor || undefined });
    if (payment.locationId !== config.locationId || payment.origin.orderId !== orderId
      || payment.total.amount !== amountCents || payment.total.currency !== 'AUD') {
      throw new Error('Tyro created a Pay Request with unexpected identity or totals.');
    }
    await TyroPayRepository.attachProviderRequest({ id, tyroPayRequestId: payment.id, status: payment.status });
    return noStore({ id, payRequestId: payment.id, paySecret: payment.paySecret, status: payment.status,
      amountCents, currency: 'AUD', liveMode: false }, 201);
  } catch (error) {
    await TyroPayRepository.markCreateFailed(id, error).catch(() => {});
    await reportRuntimeIssue({ businessId: auth.user.businessId, source: 'tyro_pay', operation: 'create_certification_payment',
      title: 'Tyro certification payment could not be created', error, context: { certification_request_id: id },
      reference: { type: 'tyro_certification', id } }).catch(() => {});
    return noStore({ error: 'Tyro certification payment could not be created.' }, 500);
  }
}