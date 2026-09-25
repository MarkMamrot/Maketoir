import { NextRequest, NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsCNRepo } from '@/lib/ims/ImsRepository';
import { query } from '@/services/MySQLService';

function normalizeAndValidateCNItems(rawItems: any[]) {
  const items = (rawItems ?? []).map((item: any) => ({
    ...item,
    qty: Math.abs(Number(item?.qty ?? 0)),
    unit_price: Math.abs(Number(item?.unit_price ?? 0)),
    tax_rate: Math.abs(Number(item?.tax_rate ?? 0)),
  }));

  if (!items.length) {
    return { items: [], error: 'Please add at least one line item.' };
  }

  if (items.some((item: any) => !(item.qty > 0))) {
    return { items: [], error: 'Credit note quantities cannot be 0. You can enter positive or negative values; the system auto-converts to positive.' };
  }

  return { items, error: null as string | null };
}

function isCustomerCreditTaxTreatment(value: unknown): value is 'ex_tax' | 'inc_tax' | 'no_tax' {
  return value === 'ex_tax' || value === 'inc_tax' || value === 'no_tax';
}


export async function GET(req: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const status = req.nextUrl.searchParams.get('status') as 'draft' | 'complete' | undefined ?? undefined;
    const channelInstanceId = (req.nextUrl.searchParams.get('channelInstanceId') ?? '').trim();
    const data = await ImsCNRepo.list(businessId, status || undefined);
    const channels = await query<{ channel_instance_id: string; display_name: string }>(
      `SELECT channel_instance_id, display_name FROM sales_channel_instances
        WHERE business_id = ? AND provider = 'shopify' ORDER BY display_name`,
      [businessId],
    );
    const channelNames = new Map(channels.map(channel => [channel.channel_instance_id, channel.display_name]));
    return NextResponse.json({
      success: true,
      data: data
        .filter(note => !channelInstanceId || note.channel_instance_id === channelInstanceId)
        .map(note => ({ ...note, channel_display_name: channelNames.get(String(note.channel_instance_id ?? '')) ?? null })),
      channels: channels.map(channel => ({ channelInstanceId: channel.channel_instance_id, displayName: channel.display_name })),
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, ...data } = body;
    if (!isCustomerCreditTaxTreatment(data.tax_treatment)) {
      return NextResponse.json({ success: false, error: 'Tax treatment must be ex_tax, inc_tax, or no_tax.' }, { status: 400 });
    }
    const normalized = normalizeAndValidateCNItems(items ?? []);
    if (normalized.error) {
      return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
    }
    if (data.so_id && normalized.items.some((item: any) => item.source_so_item_id == null)) {
      return NextResponse.json({
        success: false,
        error: 'Every line on a sales-order return must be linked to its original sales-order line. Reopen Return / Credit from the sales order.',
      }, { status: 400 });
    }
    const id = await ImsCNRepo.create({
      ...data,
      source: 'manual',
      pos_sale_id: null,
      settlement_method: 'store_credit',
      shopify_refund_id: null,
    }, normalized.items, businessId, session.name ?? session.email ?? undefined);
    const cn = await ImsCNRepo.get(id, businessId);
    return NextResponse.json({ success: true, data: cn });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
