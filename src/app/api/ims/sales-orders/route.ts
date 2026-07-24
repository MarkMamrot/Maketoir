import { NextResponse } from 'next/server';
import { ImsSORepo } from '@/lib/ims/ImsRepository';
import { refreshVariantCache } from '@/lib/ims/cacheHelper';
import { getImsSession } from '@/lib/auth/imsSession';

export async function GET(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = session.businessId as string;
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') as any ?? undefined;
    const customer = (searchParams.get('customer') ?? '').trim().toLowerCase();
    const product = (searchParams.get('product') ?? '').trim().toLowerCase();
    const from = (searchParams.get('from') ?? '').trim();
    const to = (searchParams.get('to') ?? '').trim();
    const windowDays = Math.max(0, Number(searchParams.get('window') ?? '0') || 0);
    const sortCol = (searchParams.get('sortCol') ?? 'order_date').trim();
    const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
    const pageSizeRaw = Number(searchParams.get('pageSize') ?? '25') || 25;
    const pageSize = Math.min(100, Math.max(10, pageSizeRaw));
    const rawChannel = (searchParams.get('channel') ?? 'b2b').toLowerCase();
    const channel = (['all', 'b2b', 'online', 'pos'].includes(rawChannel)
      ? rawChannel
      : 'b2b') as 'all' | 'b2b' | 'online' | 'pos';
    const soData = channel === 'pos' ? [] : await ImsSORepo.list(status, businessId, channel);
    const posLedger = (channel === 'pos' || channel === 'all')
      ? await ImsSORepo.listPosLedger(status)
      : [];

    let merged = [...soData, ...posLedger];

    if (product) {
      const [soIdsRaw, posIdsRaw] = await Promise.all([
        channel === 'pos' ? Promise.resolve<number[]>([]) : ImsSORepo.findSalesOrderIdsByProduct(product, businessId),
        channel === 'b2b' ? Promise.resolve<number[]>([]) : ImsSORepo.findPosSaleIdsByProduct(product),
      ]);
      const soIds = new Set(soIdsRaw);
      const posIds = new Set(posIdsRaw);
      merged = merged.filter((row: any) => {
        if (row?.is_pos_ledger) {
          const pid = Number(row?.pos_sale_id ?? 0);
          return posIds.has(pid);
        }
        const sid = Number(row?.id ?? 0);
        return soIds.has(sid);
      });
    }

    let rangeFrom = from;
    let rangeTo = to;
    if (!rangeFrom && !rangeTo && windowDays > 0) {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - Math.max(0, windowDays - 1));
      rangeFrom = start.toISOString().slice(0, 10);
      rangeTo = end.toISOString().slice(0, 10);
    }
    if (rangeFrom || rangeTo) {
      const low = rangeFrom || '0000-01-01';
      const high = rangeTo || '9999-12-31';
      merged = merged.filter((row: any) => {
        const d = String(row?.order_date ?? '').slice(0, 10);
        return d >= low && d <= high;
      });
    }

    if (customer) {
      merged = merged.filter((row: any) => String(row?.customer_name ?? '').toLowerCase().includes(customer));
    }

    merged.sort((a: any, b: any) => {
      const av = a?.[sortCol] ?? '';
      const bv = b?.[sortCol] ?? '';
      const an = Number(av);
      const bn = Number(bv);
      const bothNumeric = Number.isFinite(an) && Number.isFinite(bn) && String(av) !== '' && String(bv) !== '';
      const cmp = bothNumeric
        ? an - bn
        : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });

    const total = merged.length;
    const start = (page - 1) * pageSize;
    const data = merged.slice(start, start + pageSize);

    return NextResponse.json({ success: true, data, total, page, pageSize });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = session.businessId as string;
  try {
    const body = await req.json();
    const { items, ...soData } = body;
    const id = await ImsSORepo.create(soData, items ?? [], businessId);

    // EVENT-DRIVEN CACHE UPDATE (Creation affects committed stock)
    if (items && items.length > 0) {
      const vids = items.map((i: any) => i.variant_id).filter(Boolean) as string[];
      if (vids.length > 0) {
        refreshVariantCache(vids).catch(err => console.error('Failed inline cache refresh for SO creation:', err));
      }
    }

    return NextResponse.json({ success: true, id });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
