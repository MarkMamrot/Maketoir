import { NextResponse } from 'next/server';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { getImsSession } from '@/lib/auth/imsSession';
import { syncGiftCardIssueInvoice } from '@/services/XeroSyncService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { query as mainQuery } from '@/services/MySQLService';

// ── GET /api/ims/gift-cards ───────────────────────────────────────────────────
// Query params: status, search, limit, offset
export async function GET(req: Request) {
  let businessId: string | undefined;
  try {
    const session = await getImsSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    businessId = session.businessId;

    const { searchParams } = new URL(req.url);
    const status           = searchParams.get('status')            ?? '';
    const search           = searchParams.get('search')            ?? '';
    const contactShopifyId = searchParams.get('contact_shopify_id') ?? '';
    const contactId        = Number(searchParams.get('contact_id') ?? 0);
    const channelInstanceId = (searchParams.get('channelInstanceId') ?? '').trim();
    const unassignedOnly    = searchParams.get('unassigned') === '1';
    const requestedLimit = Number.parseInt(searchParams.get('limit') ?? '200', 10);
    const requestedOffset = Number.parseInt(searchParams.get('offset') ?? '0', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 200;
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0;

    const conditions: string[] = [];
    const params: any[] = [];

    if (channelInstanceId) {
      conditions.push('gc.channel_instance_id = ?');
      params.push(channelInstanceId);
    } else if (unassignedOnly) {
      conditions.push('gc.channel_instance_id IS NULL');
    }
    if (Number.isInteger(contactId) && contactId > 0) {
      conditions.push('contact.id = ?');
      params.push(contactId);
    }
    if (contactShopifyId.trim()) {
      conditions.push('gc.customer_id = ?');
      params.push(contactShopifyId.trim());
    }
    if (status && status !== 'all') {
      conditions.push('gc.status = ?');
      params.push(status);
    }
    if (search.trim()) {
      conditions.push(`(
        gc.code LIKE ? OR gc.recipient_email LIKE ? OR gc.customer_id LIKE ?
        OR contact.name LIKE ? OR contact.first_name LIKE ? OR contact.last_name LIKE ?
        OR contact.email LIKE ? OR contact.phone LIKE ? OR contact.mobile LIKE ?
      )`);
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like, like, like, like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await imsQuery<any>(
      `SELECT gc.*,
              contact.id AS contact_id,
              contact.name AS customer_name,
              contact.first_name AS customer_first_name,
              contact.last_name AS customer_last_name,
              contact.email AS customer_email,
              contact.phone AS customer_phone,
              contact.mobile AS customer_mobile
         FROM gift_cards gc
         LEFT JOIN ims_contact_channel_mappings mapping
           ON mapping.business_id = ?
          AND mapping.channel_instance_id = gc.channel_instance_id
          AND mapping.external_customer_id COLLATE utf8mb4_general_ci = gc.customer_id COLLATE utf8mb4_general_ci
          AND mapping.mapping_status = 'linked'
         LEFT JOIN ims_contacts contact
           ON contact.business_id = ?
          AND (
            contact.id = mapping.contact_id
            OR (gc.channel_instance_id IS NULL
              AND contact.shopify_customer_id COLLATE utf8mb4_general_ci = gc.customer_id COLLATE utf8mb4_general_ci)
          )
         ${where}
        ORDER BY gc.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      [session.businessId, session.businessId, ...params],
    );

    const [{ total }] = await imsQuery<any>(
      `SELECT COUNT(*) AS total
         FROM gift_cards gc
         LEFT JOIN ims_contact_channel_mappings mapping
           ON mapping.business_id = ?
          AND mapping.channel_instance_id = gc.channel_instance_id
          AND mapping.external_customer_id COLLATE utf8mb4_general_ci = gc.customer_id COLLATE utf8mb4_general_ci
          AND mapping.mapping_status = 'linked'
         LEFT JOIN ims_contacts contact
           ON contact.business_id = ?
          AND (
            contact.id = mapping.contact_id
            OR (gc.channel_instance_id IS NULL
              AND contact.shopify_customer_id COLLATE utf8mb4_general_ci = gc.customer_id COLLATE utf8mb4_general_ci)
          )
         ${where}`,
      [session.businessId, session.businessId, ...params],
    );

    const channels = await mainQuery<{ channel_instance_id: string; display_name: string; external_account_key: string | null }>(
      `SELECT channel_instance_id, display_name, external_account_key
         FROM sales_channel_instances
        WHERE business_id = ? AND provider = 'shopify'
        ORDER BY display_name, channel_instance_id`,
      [session.businessId],
    );
    const names = new Map(channels.map(channel => [channel.channel_instance_id, channel.display_name]));
    const domains = new Map(channels.map(channel => [channel.channel_instance_id, channel.external_account_key]));
    return NextResponse.json({
      success: true,
      data: rows.map(row => ({
        ...row,
        channel_display_name: names.get(String(row.channel_instance_id ?? '')) ?? null,
        channel_shop_domain: domains.get(String(row.channel_instance_id ?? '')) ?? null,
      })),
      total: Number(total),
      channels: channels.map(channel => ({
        channelInstanceId: channel.channel_instance_id,
        displayName: channel.display_name,
        shopDomain: channel.external_account_key,
      })),
    });
  } catch (e: any) {
    console.error('[gift-cards GET] FULL ERROR:', e.message, e.stack);
    await reportRuntimeIssue({
      businessId,
      source: 'ims',
      operation: 'gift_card_list',
      title: 'Gift cards could not be loaded',
      error: e,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Gift cards could not be loaded.' }, { status: 500 });
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
      const channelInstanceId = typeof body.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
      if (channelInstanceId) {
        const owned = await mainQuery<{ channel_instance_id: string }>(
          `SELECT channel_instance_id FROM sales_channel_instances
            WHERE business_id = ? AND channel_instance_id = ? AND provider = 'shopify' LIMIT 1`,
          [session.businessId, channelInstanceId],
        );
        if (!owned[0]) return NextResponse.json({ error: 'The selected Shopify storefront was not found.' }, { status: 400 });
      }
      let inserted = 0;
      let skipped  = 0;
      const errors: string[] = [];

      for (const row of body.rows) {
        const code = String(row.code ?? '').trim();
        if (!code) { skipped++; continue; }
        try {
          await imsExecute(
            `INSERT IGNORE INTO gift_cards
               (channel_instance_id, code, initial_balance, balance, status, customer_id, order_id,
                shopify_location_id, recipient_email, created_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              channelInstanceId || null,
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

    const issueDate = String(created_at ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const amount = Number(initial_balance ?? balance ?? 0);
    let xeroSynced = false;
    let xeroWarning: string | null = null;
    try {
      const xeroId = await syncGiftCardIssueInvoice({
        businessId: session.businessId,
        amount,
        issueDate,
        reference: `IMS-GC-${String(result.insertId)}`,
        narration: `Gift card issued in IMS (${code.trim().toUpperCase()})`,
        dedupeKey: `gift card issue ims ${String(result.insertId)}|${code.trim().toUpperCase()}|${amount.toFixed(2)}`,
        referenceId: Number(result.insertId),
      });
      xeroSynced = !!xeroId;
    } catch (err: any) {
      xeroWarning = err?.message ?? 'Gift card created but failed to sync to Xero';
    }

    return NextResponse.json({ success: true, id: result.insertId, xero_synced: xeroSynced, xero_warning: xeroWarning });
  } catch (e: any) {
    if (e.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'A gift card with that code already exists.' }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
