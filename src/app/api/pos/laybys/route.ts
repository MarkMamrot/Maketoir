import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getImsSession } from '@/lib/auth/imsSession';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { LaybyRepository } from '@/lib/pos/laybyRepository';
import { LaybyValidationError } from '@/lib/pos/laybyPayments';
import { applyCompletedPosSaleStock, PosRegisterSessionRepo, PosSalesRepo } from '@/lib/db/PosRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { FifoCostingConflict } from '@/lib/ims/costing/fifoCostingService';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';

async function context() {
  const bound = await getImsSession(['pos_session']);
  const raw = cookies().get('pos_session')?.value;
  if (!bound?.businessId || !raw) return null;
  try {
    const pos = JSON.parse(raw);
    if (pos.businessId !== bound.businessId || !Number.isInteger(pos.location_id) || !Number.isInteger(pos.register_id)) return null;
    return { businessId: bound.businessId, locationId: pos.location_id, registerId: pos.register_id, cashierId: pos.pos_user_id ?? null };
  } catch { return null; }
}

export async function GET(request: Request) {
  const session = await context();
  if (!session) return NextResponse.json({ error: 'Sign in to the assigned POS register.' }, { status: 401 });
  try {
    const laybys = await runImsForBusiness(session.businessId, () => LaybyRepository.list(session.businessId, session.locationId, new URL(request.url).searchParams.get('closed') === '1'));
    return NextResponse.json({ laybys });
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'pos_layby', operation: 'list', title: 'POS laybys could not be loaded', error, context: { locationId: session.locationId } });
    return NextResponse.json({ error: 'Laybys could not be loaded. Check the layby schema and try again.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await context();
  if (!session) return NextResponse.json({ error: 'Sign in to the assigned POS register.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !['payment', 'collect', 'cancel', 'adopt', 'preflight'].includes(body.action) || (body.action !== 'preflight' && !Number.isInteger(body.sale_id))) {
    return NextResponse.json({ error: 'Choose a valid layby action.' }, { status: 400 });
  }
  try {
    return await runImsForBusiness(session.businessId, async () => {
      const register = await PosRegisterSessionRepo.getCurrent(session.registerId);
      if (!register || register.location_id !== session.locationId) throw new LaybyValidationError('Open the current register first.');
      if (body.action === 'preflight') {
        await LaybyRepository.preflight(session.businessId, session.locationId, body.customer_id, body.items);
        return NextResponse.json({ success: true });
      }
      const result = await LaybyRepository.act({
        actor: { ...session, registerSessionId: register.id }, saleId: body.sale_id,
        operationKey: String(body.operation_key ?? ''), action: body.action,
        payments: body.payments, collect: body.collect === true,
        feeOverride: body.fee_override == null ? undefined : Number(body.fee_override),
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        collectStock: applyCompletedPosSaleStock,
      });
      const transaction = await PosSalesRepo.get(body.sale_id);
      if (result.collected && transaction?.sale.customer_id) {
        try { await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({ businessId: session.businessId, contactId: transaction.sale.customer_id }); }
        catch (error) { await reportRuntimeIssue({ businessId: session.businessId, source: 'pos_layby', operation: 'sync_loyalty', title: 'Collected layby loyalty sync failed', error, reference: { type: 'pos_sale', id: body.sale_id } }); }
      }
      try { await refreshVariantCache(transaction?.items.map(item => item.variant_id).filter(Boolean) as string[]); }
      catch (error) { await reportRuntimeIssue({ businessId: session.businessId, source: 'pos_layby', operation: 'refresh_stock_cache', title: 'Layby stock cache refresh failed', error, reference: { type: 'pos_sale', id: body.sale_id } }); }
      return NextResponse.json({ success: true, ...result, transaction });
    });
  } catch (error) {
    if (error instanceof LaybyValidationError || error instanceof FifoCostingConflict) return NextResponse.json({ error: error.message }, { status: error.status });
    await reportRuntimeIssue({ businessId: session.businessId, source: 'pos_layby', operation: String(body.action), title: 'POS layby action failed', error, reference: { type: 'pos_sale', id: body.sale_id ?? 'preflight' }, context: { locationId: session.locationId } });
    return NextResponse.json({ error: 'The layby action could not be confirmed. Retry the same action without charging or refunding again.' }, { status: 500 });
  }
}