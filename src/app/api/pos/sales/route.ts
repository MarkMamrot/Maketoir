import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PosSalesRepo, PosRegisterSessionRepo } from '@/lib/db/PosRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { createNotification } from '@/lib/ims/createNotification';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { buildPosReturnCreditNoteItems, isPosExchange } from '@/lib/ims/posReturnCreditNote';
import { LoyaltyRepository, LoyaltyReturnBlockedError, LoyaltyValidationError } from '@/lib/ims/LoyaltyRepository';
import { allowsIncomingTransferSales, posLocationSettingsKey } from '@/lib/pos/locationSettings';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

function getPosSession() {
  const raw = cookies().get('pos_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function localDate(businessId: string): Promise<string> {
  const timeZone = await getBusinessTimeZone(businessId);
  return new Date().toLocaleDateString('en-CA', { timeZone });
}

async function ensurePosReturnCreditNote(body: any, saleId: number, businessId: string, locationId: number, createdBy?: string) {
  if ((body.sale_type ?? 'sale') !== 'return' || (body.status ?? 'completed') !== 'completed') return null;

  const existing = await ImsCNRepo.getByPosSale(saleId, businessId);
  if (existing) {
    await ImsCNRepo.complete(existing.id, businessId);
    await PosSalesRepo.linkCreditNote(saleId, existing.id, businessId);
    return existing.id;
  }

  const settlementMethod = (body.payments ?? []).some((payment: any) => payment.payment_method === 'Store Credit (Issue)')
    ? 'store_credit'
    : 'refund';
  if (settlementMethod === 'store_credit' && !body.customer_id) {
    throw new Error('Select a customer before issuing store credit for a return');
  }

  const items = buildPosReturnCreditNoteItems(body.items ?? []);
  if (!items.length) throw new Error('POS return must contain at least one item');

  const exchange = isPosExchange(body.items ?? []);

  const creditNoteId = await ImsCNRepo.create({
    location_id: locationId,
    cn_date: body.trading_date ?? await localDate(businessId),
    reference: `${exchange ? 'POS Exchange' : 'POS Return'} #${saleId}`,
    tax_treatment: 'inc_tax',
    tax_code: null,
    notes: body.notes ?? (exchange ? 'Return portion of a mixed POS exchange' : null),
    customer_id: body.customer_id ?? null,
    source: 'pos',
    pos_sale_id: saleId,
    settlement_method: settlementMethod,
    original_so_number: body.return_of_sale_id ? `POS Sale #${body.return_of_sale_id}` : null,
  }, items, businessId, createdBy);

  await ImsCNRepo.complete(creditNoteId, businessId);
  await PosSalesRepo.linkCreditNote(saleId, creditNoteId, businessId);
  return creditNoteId;
}

// GET /api/pos/sales?location_id=3&date=2025-06-02&parked=1
export async function GET(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  const { searchParams } = new URL(req.url);
  const locationId = parseInt(searchParams.get('location_id') ?? String(session.location_id), 10);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const parked = searchParams.get('parked') === '1';

  if (parked) {
    const sales = await PosSalesRepo.listParked(locationId);
    return NextResponse.json({ sales });
  }

  const sales = await PosSalesRepo.list(locationId, date);
  return NextResponse.json({ sales });
}

// POST /api/pos/sales — create/complete a sale (supports offline-first via local_id)
export async function POST(req: Request) {
  const session = getPosSession();
  if (!session) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  await getImsSession(['pos_session']);

  try {
    const body = await req.json();
    const businessId = String(session.businessId ?? '');
    if (!businessId) return NextResponse.json({ error: 'Business context is required.' }, { status: 400 });
    const locationId = Number(body.location_id ?? session.location_id);
    if (!Number.isFinite(locationId)) return NextResponse.json({ error: 'POS location is required.' }, { status: 400 });

    if (body.is_training === true) {
      const items = Array.isArray(body.items) ? body.items : [];
      const payments = Array.isArray(body.payments) ? body.payments : [];
      const localId = String(body.local_id ?? '').trim();
      const hasCustomerValue = body.loyalty_reward_id != null
        || body.return_of_sale_id != null
        || items.some((item: any) => Boolean(item?.is_gift_card) || Number(item?.qty ?? 0) <= 0)
        || payments.some((payment: any) => /gift card|store credit/i.test(String(payment?.payment_method ?? '')));
      if (!localId || items.length === 0 || items.length > 200 || payments.length > 20) {
        return NextResponse.json({ error: 'Training sale details are incomplete or exceed supported limits.' }, { status: 400 });
      }
      if ((body.sale_type ?? 'sale') !== 'sale' || (body.status ?? 'completed') !== 'completed' || hasCustomerValue) {
        return NextResponse.json({ error: 'Training Mode supports ordinary simulated sales only.' }, { status: 400 });
      }

      const safeItems = items.map((item: any) => ({
        variant_id: item?.variant_id ?? null,
        code: item?.code ?? null,
        name: String(item?.name ?? '').slice(0, 500),
        qty: Number(item?.qty ?? 0),
        unit_price: Number(item?.unit_price ?? 0),
        original_price: item?.original_price == null ? null : Number(item.original_price),
        discount_type: item?.discount_type ?? 'none',
        discount_value: Number(item?.discount_value ?? 0),
        discount_amount: Number(item?.discount_amount ?? 0),
        tax_rate: Number(item?.tax_rate ?? 10),
        line_total: Number(item?.line_total ?? 0),
      }));
      const safePayments = payments.map((payment: any) => ({
        payment_method: String(payment?.payment_method ?? '').slice(0, 100),
        amount: Number(payment?.amount ?? 0),
      }));
      const result = await imsExecute(
        `INSERT INTO pos_training_sales
           (business_id, local_id, location_id, register_id, cashier_id, cashier_name,
            sale_type, customer_name, customer_phone, subtotal, discount_total, tax_total,
            total, cash_rounding, notes, items_json, payments_json)
         VALUES (?, ?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [
          businessId,
          localId,
          locationId,
          body.register_id ?? session.register_id ?? null,
          body.cashier_id || session.pos_user_id || null,
          session.full_name || session.username || null,
          body.customer_name ?? null,
          body.customer_phone ?? null,
          Number(body.subtotal ?? 0),
          Number(body.discount_total ?? 0),
          Number(body.tax_total ?? 0),
          Number(body.total ?? 0),
          Number(body.cash_rounding ?? 0),
          body.notes == null ? null : String(body.notes).slice(0, 5000),
          JSON.stringify(safeItems),
          JSON.stringify(safePayments),
        ],
      );
      return NextResponse.json({ success: true, training: true, training_id: Number((result as any).insertId) });
    }

    const isStoreCreditReturn = (body.sale_type ?? 'sale') === 'return'
      && (body.payments ?? []).some((payment: any) => payment.payment_method === 'Store Credit (Issue)');
    if (isStoreCreditReturn && !body.customer_id) {
      return NextResponse.json({ error: 'Select a customer before issuing store credit for a return.' }, { status: 400 });
    }

    // Idempotency: if local_id already exists, return the existing sale id
    if (body.local_id) {
      const existing = await PosSalesRepo.findByLocalId(body.local_id);
      if (existing) {
        const creditNoteId = await ensurePosReturnCreditNote(body, existing.id, businessId, locationId, session.username ?? session.full_name);
        const loyalty = await LoyaltyRepository.getMutationByIdempotencyKey(businessId, `pos:sale:${existing.id}:earn`);
        return NextResponse.json({ success: true, id: existing.id, credit_note_id: creditNoteId, loyalty, duplicate: true });
      }
    }

    // Resolve which register SESSION this sale belongs to, so end-of-day
    // reconciliation sums by session (handles shifts that cross midnight or a
    // register left open across days) rather than by calendar date.
    const registerId = body.register_id ?? session.register_id ?? null;
    let registerSessionId: number | null = body.register_session_id ?? null;
    if (registerSessionId == null && registerId) {
      const openSession = await PosRegisterSessionRepo.getCurrent(Number(registerId)).catch(() => null);
      registerSessionId = openSession?.id ?? null;
    }

    const locationSettings = await imsQuery<{ value: string }>(
      'SELECT `value` FROM ims_settings WHERE business_id = ? AND `key` = ? LIMIT 1',
      [businessId, posLocationSettingsKey(locationId)],
    );
    const { saleId, stockError, stockWarnings, loyalty, loyaltyPoints, loyaltyRedemption } = await PosSalesRepo.complete({
      business_id:       businessId,
      local_id:          body.local_id ?? null,
      register_id:       registerId,
      register_session_id: registerSessionId,
      location_id:       locationId,
      cashier_id:        (body.cashier_id || session.pos_user_id) || null,
      cashier_name:      session.full_name || session.username || null,
      sale_type:         body.sale_type   ?? 'sale',
      status:            body.status      ?? 'completed',
      customer_id:       body.customer_id ?? null,
      customer_name:     body.customer_name  ?? null,
      customer_phone:    body.customer_phone ?? null,
      loyalty_reward_id: body.loyalty_reward_id == null ? null : Number(body.loyalty_reward_id),
      loyalty_discount_total: Number(body.loyalty_discount_total ?? 0),
      subtotal:          Number(body.subtotal       ?? 0),
      discount_total:    Number(body.discount_total ?? 0),
      tax_total:         Number(body.tax_total      ?? 0),
      total:             Number(body.total          ?? 0),
      cash_rounding:     Number(body.cash_rounding  ?? 0),
      notes:             body.notes        ?? null,
      parked_label:      body.parked_label ?? null,
      return_of_sale_id: body.return_of_sale_id ?? null,
      allow_incoming_transfer_sales: allowsIncomingTransferSales(locationSettings[0]?.value),
      items:             (body.items ?? []).map((item: any) => ({ ...item, is_gift_card: Boolean(item.is_gift_card) })),
      payments:          body.payments ?? [],
    });
    const creditNoteId = await ensurePosReturnCreditNote(body, saleId, businessId, locationId, session.username ?? session.full_name);

    // EVENT-DRIVEN CACHE UPDATE: update sales velocity and stock for the variants sold
    if (body.status === 'completed' && body.items?.length > 0) {
      const vids = body.items.map((i: any) => i.variant_id).filter(Boolean);
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for POS sale:', err));
      }
    }

    // Persist a notification so the IMS operator is alerted when POS stock deduction fails
    if (stockError) {
      const bizId: string = session.businessId ?? '';
      if (bizId) {
        createNotification(
          bizId,
          'pos_stock',
          'POS Stock Deduction Failed',
          stockError,
          {
            sale_id:     saleId ?? null,
            local_id:    body.local_id ?? null,
            location_id: body.location_id ?? session.location_id ?? null,
            items: (body.items ?? []).map((i: any) => ({
              variant_id: i.variant_id ?? null,
              sku:        i.sku        ?? null,
              name:       i.name       ?? null,
              qty:        i.qty        ?? i.quantity ?? null,
            })),
          },
        ).catch(err => console.error('[notifications] POS stock notify failed:', err));
      }
    }

    const generalStockWarnings = stockWarnings.filter(warning => warning.reason !== 'incoming_transfer_stock');
    if (generalStockWarnings.length > 0) {
      const adjustedQuantity = generalStockWarnings.reduce((sum, warning) => sum + Number(warning.automaticAdjustmentQuantity ?? 0), 0);
      const warningDetail = adjustedQuantity > 0
        ? `required ${adjustedQuantity} unit${adjustedQuantity === 1 ? '' : 's'} of automatic stock correction or reduced stock below committed customer demand`
        : 'reduced stock below committed customer demand';
      createNotification(
        businessId,
        'pos_stock_availability',
        'POS sale needs a stock check',
        `Sale #${saleId} ${warningDetail}. Check the items and perform a stocktake or adjustment if required.`,
        { sale_id: saleId, location_id: locationId, warnings: generalStockWarnings },
        'warning',
      ).catch(err => console.error('[notifications] POS availability warning failed:', err));
    }

    return NextResponse.json({
      success: true,
      id: saleId,
      credit_note_id: creditNoteId,
      loyalty,
      loyalty_points: loyaltyPoints,
      loyalty_redemption: loyaltyRedemption,
      stockWarnings,
      ...(stockError ? { stockWarning: stockError } : {}),
    });
  } catch (err: any) {
    console.error('POS sale create error:', err);
    const status = err instanceof LoyaltyReturnBlockedError ? err.status : err instanceof LoyaltyValidationError ? 400 : 500;
    return NextResponse.json({ error: err.message || String(err) }, { status });
  }
}
