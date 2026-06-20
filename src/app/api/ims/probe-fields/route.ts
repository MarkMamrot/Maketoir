import { cookies } from 'next/headers';
import { getCin7Credentials, cin7FetchAllPages } from '@/lib/cin7Helpers';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 });

  const businessId: string = session.businessId;
  let creds: Awaited<ReturnType<typeof getCin7Credentials>>;
  try { creds = await getCin7Credentials(businessId); }
  catch (e: any) { return Response.json({ error: e.message }, { status: 400 }); }

  const result: any = {};

  // ── Sample 1 product — all keys at product + productOptions level ──────────
  try {
    const products = await fetch('https://api.cin7.com/api/v1/Products?rows=3&page=1', {
      headers: { Authorization: creds.authHeader },
    }).then(r => r.json());

    result.product_keys = products[0] ? Object.keys(products[0]) : [];
    result.product_custom_fields = products[0]?.customFields ?? null;
    result.product_option_keys = products[0]?.productOptions?.[0]
      ? Object.keys(products[0].productOptions[0])
      : [];

    // Find any zone/bin/location/shelf fields at product or option level
    const interesting: Record<string, any> = {};
    for (const p of products.slice(0, 3)) {
      for (const [k, v] of Object.entries(p)) {
        if (/zone|bin|location|shelf|aisle/i.test(k)) interesting[`product.${k}`] = v;
      }
      if (p.customFields) {
        for (const [k, v] of Object.entries(p.customFields as Record<string, any>)) {
          interesting[`product.customFields.${k}`] = v;
        }
      }
      for (const opt of (p.productOptions ?? [])) {
        for (const [k, v] of Object.entries(opt as Record<string, any>)) {
          if (/zone|bin|location|shelf|aisle/i.test(k)) interesting[`option.${k}`] = v;
        }
      }
    }
    result.product_interesting_fields = interesting;
  } catch (e: any) {
    result.product_error = e.message;
  }

  // ── Sample stock records — all unique keys + zone/bin values ───────────────
  try {
    const stock = await fetch('https://api.cin7.com/api/v1/Stock?rows=50&page=1', {
      headers: { Authorization: creds.authHeader },
    }).then(r => r.json());

    const allStockKeys = new Set<string>();
    const zoneValues: any[] = [];

    for (const s of (Array.isArray(stock) ? stock : [])) {
      Object.keys(s).forEach(k => allStockKeys.add(k));
      for (const [k, v] of Object.entries(s)) {
        if (/zone|bin|location|shelf|aisle/i.test(k) && v != null && v !== '' && v !== 0) {
          zoneValues.push({ branch: s.branchName, sku: s.code, field: k, value: v });
        }
      }
    }

    result.stock_all_keys = [...allStockKeys];
    result.stock_zone_bin_values = zoneValues.slice(0, 20);
    result.stock_first_record = (Array.isArray(stock) && stock[0]) ? stock[0] : null;

    // Find a warehouse record specifically
    const whRecord = Array.isArray(stock)
      ? stock.find((s: any) => /warehouse|wh/i.test(s.branchName ?? ''))
      : null;
    result.stock_warehouse_sample = whRecord ?? null;
  } catch (e: any) {
    result.stock_error = e.message;
  }

  return Response.json(result, { status: 200 });
}
