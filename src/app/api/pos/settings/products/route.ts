import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { imsQuery } from '@/services/IMSMySQLService';

function getAdminSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

export async function GET() {
  try {
    const session = getAdminSession();
    const businessId = session?.businessId as string | undefined;
    const rows = await imsQuery<{ value: string }>(
      `SELECT \`value\` FROM ims_settings WHERE \`key\` = 'pos_default_product_view'${businessId ? ' AND business_id = ?' : ''} LIMIT 1`,
      businessId ? [businessId] : undefined
    );
    const defaultView = rows[0]?.value ?? 'all';

    // If it's a variants list, also resolve the names so the UI can show them
    let selectedVariants: { variant_id: string; name: string; sku: string | null }[] = [];
    if (defaultView.startsWith('variants:')) {
      const ids = defaultView.slice(9).split(',').filter(Boolean);
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const vrows = await imsQuery<{ variant_id: string; product_name: string; sku: string | null }>(
          `SELECT v.variant_id, p.name AS product_name, v.sku
           FROM ims_product_variants v
           JOIN ims_products p ON p.product_id = v.product_id
           WHERE v.variant_id IN (${placeholders})`,
          ids
        ).catch(() => []);
        const nameMap = new Map(vrows.map(r => [r.variant_id, r]));
        selectedVariants = ids.map(id => {
          const r = nameMap.get(id);
          return { variant_id: id, name: r?.product_name ?? '[Unknown product]', sku: r?.sku ?? null };
        });
      }
    }

    return NextResponse.json({ defaultView, selectedVariants });
  } catch {
    return NextResponse.json({ defaultView: 'all', selectedVariants: [] });
  }
}

export async function PUT(req: Request) {
  try {
    const session = getAdminSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    const businessId = session.businessId as string;

    const { defaultView } = await req.json() as { defaultView: string };
    const allowed = ['all', 'in_stock'];
    const safe = allowed.includes(defaultView) || defaultView.startsWith('brand:') || defaultView.startsWith('variants:')
      ? defaultView
      : 'all';
    await imsQuery(
      "INSERT INTO ims_settings (business_id, `key`, `value`) VALUES (?, 'pos_default_product_view', ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
      [businessId, safe]
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
