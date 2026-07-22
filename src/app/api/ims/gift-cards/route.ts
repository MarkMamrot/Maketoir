import { NextResponse } from 'next/server';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';

// ── GET /api/ims/gift-cards ───────────────────────────────────────────────────
// Query params: status, search, limit, offset
export async function GET(req: Request) {
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const status  = searchParams.get('status')  ?? '';
    const search  = searchParams.get('search')  ?? '';
    const limit   = Math.min(parseInt(searchParams.get('limit')  ?? '200', 10), 500);
    const offset  = parseInt(searchParams.get('offset') ?? '0', 10);

    console.log('[gift-cards GET] session businessId:', session.businessId);
    const conditions: string[] = [];
    const params: any[] = [];

    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }
    if (search.trim()) {
      conditions.push('(code LIKE ? OR recipient_email LIKE ? OR customer_id LIKE ?)');
      const like = `%${search.trim()}%`;
      params.push(like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await imsQuery<any>(
      `SELECT * FROM gift_cards ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const [{ total }] = await imsQuery<any>(
      `SELECT COUNT(*) AS total FROM gift_cards ${where}`,
      params,
    );

    console.log('[gift-cards GET] rows:', rows.length, 'total:', total);
    return NextResponse.json({ success: true, data: rows, total: Number(total) });
  } catch (e: any) {
    console.error('[gift-cards GET] FULL ERROR:', e.message, e.stack);
    return NextResponse.json({ success: false, error: e.message, stack: e.stack }, { status: 500 });
  }
}

// ── POST /api/ims/gift-cards ──────────────────────────────────────────────────
// Body: single card object OR { bulk: true, rows: [...] } for import
export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });

  try {
    const body = await req.json();

    // ── Bulk import ──────────────────────────────────────────────────────────
    if (body.bulk === true && Array.isArray(body.rows)) {
      let inserted = 0;
      let skipped  = 0;
      const errors: string[] = [];

      for (const row of body.rows) {
        const code = String(row.code ?? '').trim();
        if (!code) { skipped++; continue; }
        try {
          await imsExecute(
            `INSERT IGNORE INTO gift_cards
               (code, initial_balance, balance, status, customer_id, order_id,
                shopify_location_id, recipient_email, created_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              code,
              row.initial_balance ?? null,
              Number(row.balance ?? 0),
              row.status ?? 'active',
              row.customer_id   || null,
              row.order_id      || null,
              row.shopify_location_id || null,
              row.recipient_email     || null,
              row.created_at   || null,
              row.last_used_at || null,
            ],
          );
          inserted++;
        } catch (err: any) {
          if (err.code === 'ER_DUP_ENTRY') { skipped++; }
          else { errors.push(`${code}: ${err.message}`); }
        }
      }

      return NextResponse.json({ success: true, inserted, skipped, errors });
    }

    // ── Single create ────────────────────────────────────────────────────────
    const {
      code, initial_balance, balance, status = 'active',
      customer_id, order_id, shopify_location_id, recipient_email, notes, created_at, last_used_at,
    } = body;

    if (!code?.trim()) return NextResponse.json({ error: 'code is required' }, { status: 400 });
    if (balance == null) return NextResponse.json({ error: 'balance is required' }, { status: 400 });

    const result = await imsExecute(
      `INSERT INTO gift_cards
         (code, initial_balance, balance, status, customer_id, order_id,
          shopify_location_id, recipient_email, notes, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code.trim().toUpperCase(),
        initial_balance ?? balance,
        Number(balance),
        status,
        customer_id   || null,
        order_id      || null,
        shopify_location_id || null,
        recipient_email     || null,
        notes               || null,
        created_at          || null,
        last_used_at        || null,
      ],
    );

    return NextResponse.json({ success: true, id: result.insertId });
  } catch (e: any) {
    if (e.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'A gift card with that code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
