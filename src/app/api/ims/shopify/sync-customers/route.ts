import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { shopifyDisabledResponse } from '@/lib/shopifyCapability';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { getShopifyOperationContext, ShopifyOperationContextError } from '@/lib/channels/shopifyOperationContext';
import { getContactChannelMapping, recordInboundContactChannelMapping } from '@/lib/ims/contactChannelMappings';
import { ensureContactShopifyCustomerSchema } from '@/lib/ims/ensureContactShopifyCustomerSchema';
import { syncRetailCustomerToShopify } from '@/lib/ims/shopifyCustomerSync';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

type ShopifyCustomer = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  state?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  tags?: string | null;
  note?: string | null;
  orders_count?: number | null;
  last_order_id?: number | null;
  accepts_marketing?: boolean | null;
  marketing_opt_in_level?: string | null;
  email_marketing_consent?: any;
  sms_marketing_consent?: any;
};

type ImsContactRow = {
  id: number;
  type: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  customer_code: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  notes: string | null;
  is_active: number;
  promo_email: number | null;
  promo_sms: number | null;
  shopify_customer_id: string | null;
};

function normalizeString(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function customerName(customer: ShopifyCustomer) {
  const fullName = [normalizeString(customer.first_name), normalizeString(customer.last_name)].filter(Boolean).join(' ');
  return fullName || normalizeString(customer.email) || `Shopify Customer #${customer.id}`;
}

function customerActive(customer: ShopifyCustomer) {
  return String(customer.state ?? '').toLowerCase() === 'disabled' ? 0 : 1;
}

function extractCustomerCode(customer: ShopifyCustomer) {
  const sources = [customer.note, customer.tags].map(normalizeString).filter(Boolean) as string[];
  for (const source of sources) {
    const match = source.match(/(?:customer[_ -]?code|customer code|code)\s*[:=#-]\s*([A-Za-z0-9._-]+)/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function parseMarketingFlag(value: any) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const state = String(value.state ?? value.consent_state ?? value.status ?? '').toLowerCase();
  if (['subscribed', 'enabled', 'consented', 'opted_in', 'accepted', 'true', 'yes', '1'].includes(state)) return 1;
  if (['unsubscribed', 'disabled', 'declined', 'opted_out', 'rejected', 'false', 'no', '0'].includes(state)) return 0;
  const marketingState = String(value.marketing_state ?? '').toLowerCase();
  if (['subscribed', 'enabled', 'consented'].includes(marketingState)) return 1;
  if (['unsubscribed', 'disabled', 'declined'].includes(marketingState)) return 0;
  return null;
}

function marketingEmailFlag(customer: ShopifyCustomer) {
  const consent = parseMarketingFlag(customer.email_marketing_consent);
  if (consent != null) return consent;
  const optInLevel = String(customer.marketing_opt_in_level ?? '').toLowerCase();
  if (['single_opt_in', 'confirmed_opt_in', 'opt_in'].includes(optInLevel)) return 1;
  if (typeof customer.accepts_marketing === 'boolean') return customer.accepts_marketing ? 1 : 0;
  return null;
}

function marketingSmsFlag(customer: ShopifyCustomer) {
  return parseMarketingFlag(customer.sms_marketing_consent);
}

function scopeHint(message: string) {
  return /403|scope|permission|access denied|read_customers/i.test(message)
    ? `${message} Add the read_customers scope to your Shopify custom app, reinstall/update the app token, and save the new token in Setup -> Connections.`
    : message;
}

function buildUpdate(existing: ImsContactRow, customer: ShopifyCustomer, activeMonthsCutoff: Date, activeCustomerIds: Set<string>) {
  const nextFirstName = normalizeString(customer.first_name);
  const nextLastName = normalizeString(customer.last_name);
  const nextEmail = normalizeString(customer.email);
  const nextPhone = normalizeString(customer.phone);
  const nextName = customerName(customer);
  const nextCustomerCode = extractCustomerCode(customer);
  const nextNotes = normalizeString(customer.note);
  const nextPromoEmail = marketingEmailFlag(customer);
  const nextPromoSms = marketingSmsFlag(customer);
  const createdAt = customer.created_at ? new Date(customer.created_at).getTime() : null;
  const hasRecentActivity = activeCustomerIds.has(String(customer.id));
  const activeByWindow = hasRecentActivity || (createdAt != null && !Number.isNaN(createdAt) && createdAt >= activeMonthsCutoff.getTime());

  const update: Record<string, string | number | null> = {
    is_active: customerActive(customer) === 0 ? 0 : (activeByWindow ? 1 : 0),
  };

  if (!normalizeString(existing.first_name) && nextFirstName) update.first_name = nextFirstName;
  if (!normalizeString(existing.last_name) && nextLastName) update.last_name = nextLastName;
  if (!normalizeString(existing.email) && nextEmail) update.email = nextEmail;
  if (!normalizeString(existing.phone) && nextPhone) update.phone = nextPhone;
  if (!normalizeString(existing.mobile) && nextPhone) update.mobile = nextPhone;
  if (!normalizeString(existing.name) && nextName) update.name = nextName;
  if (!normalizeString(existing.customer_code) && nextCustomerCode) update.customer_code = nextCustomerCode;
  if (!normalizeString(existing.notes) && nextNotes) update.notes = nextNotes;
  if (nextPromoEmail != null) update.promo_email = nextPromoEmail;
  if (nextPromoSms != null) update.promo_sms = nextPromoSms;
  if (existing.type === 'lead') update.type = 'retail_customer';

  return update;
}

async function updateContact(id: number, patch: Record<string, string | number | null>) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (!entries.length) return false;
  const sets = entries.map(([field]) => `${field} = ?`);
  const values = entries.map(([, value]) => value);
  values.push(id);
  await imsExecute(`UPDATE ims_contacts SET ${sets.join(', ')} WHERE id = ?`, values);
  return true;
}

async function getGiftCardLinkStats(businessId: string, channelInstanceId: string) {
  const [matched] = await imsQuery<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM gift_cards gc
     JOIN ims_contact_channel_mappings mapping
       ON mapping.business_id = ? AND mapping.channel_instance_id = ?
      AND mapping.external_customer_id = gc.customer_id AND mapping.mapping_status = 'linked'
     WHERE gc.customer_id IS NOT NULL AND gc.customer_id <> ''`,
    [businessId, channelInstanceId],
  ).catch(() => [{ total: 0 }]);

  const [missing] = await imsQuery<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM gift_cards gc
     LEFT JOIN ims_contact_channel_mappings mapping
       ON mapping.business_id = ? AND mapping.channel_instance_id = ?
      AND mapping.external_customer_id = gc.customer_id AND mapping.mapping_status = 'linked'
     WHERE gc.customer_id IS NOT NULL AND gc.customer_id <> '' AND mapping.id IS NULL`,
    [businessId, channelInstanceId],
  ).catch(() => [{ total: 0 }]);

  const missingRows = await imsQuery<{
    code: string;
    customer_id: string;
    recipient_email: string | null;
    created_at: string | null;
  }>(
    `SELECT gc.code, gc.customer_id, gc.recipient_email, gc.created_at
     FROM gift_cards gc
     LEFT JOIN ims_contact_channel_mappings mapping
       ON mapping.business_id = ? AND mapping.channel_instance_id = ?
      AND mapping.external_customer_id = gc.customer_id AND mapping.mapping_status = 'linked'
     WHERE gc.customer_id IS NOT NULL AND gc.customer_id <> '' AND mapping.id IS NULL
     ORDER BY gc.created_at DESC
     LIMIT 12`,
    [businessId, channelInstanceId],
  ).catch(() => []);

  return {
    matchedGiftCardCustomers: Number(matched?.total ?? 0),
    missingGiftCardCustomers: Number(missing?.total ?? 0),
    missingGiftCardExamples: missingRows.map(row => ({
      code: row.code,
      customer_id: row.customer_id,
      recipient_email: row.recipient_email,
      created_at: row.created_at,
    })),
  };
}

export async function GET(request: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const channelInstanceId = new URL(request.url).searchParams.get('channelInstanceId')?.trim() ?? '';
  if (!channelInstanceId) return NextResponse.json({ error: 'channelInstanceId is required.' }, { status: 400 });
  try {
    const context = await getShopifyOperationContext({ businessId: session.businessId, channelInstanceId });
    return NextResponse.json({ success: true, outboundEnabled: shopifyInstanceSettings(context.instance.settings).customers.outboundEnabled });
  } catch (error) {
    const message = error instanceof ShopifyOperationContextError ? error.message : 'Shopify storefront is unavailable.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const channelInstanceId = typeof body.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
  if (!channelInstanceId || typeof body.outboundEnabled !== 'boolean') {
    return NextResponse.json({ error: 'channelInstanceId and outboundEnabled are required.' }, { status: 400 });
  }
  try {
    const context = await getShopifyOperationContext({ businessId: session.businessId, channelInstanceId });
    const settings = shopifyInstanceSettings(context.instance.settings);
    settings.customers.outboundEnabled = body.outboundEnabled;
    const updated = await SalesChannelInstanceRepository.setShopifySettingsForBusiness({
      businessId: session.businessId,
      channelInstanceId,
      settings,
    });
    if (!updated) return NextResponse.json({ error: 'Shopify storefront was not found.' }, { status: 404 });
    return NextResponse.json({ success: true, outboundEnabled: body.outboundEnabled });
  } catch (error) {
    const message = error instanceof ShopifyOperationContextError ? error.message : 'Shopify customer settings could not be saved.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const session = await getImsSession();
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  const disabled = await shopifyDisabledResponse(session.businessId); if (disabled) return disabled;

  const body = await req.json().catch(() => ({}));
  const channelInstanceId = typeof body?.channelInstanceId === 'string' ? body.channelInstanceId.trim() : '';
  if (!channelInstanceId) {
    return NextResponse.json({ error: 'channelInstanceId is required.' }, { status: 400 });
  }
  const mode = body?.mode === 'push' ? 'push' : 'pull';
  const pageInfo = typeof body?.pageInfo === 'string' && body.pageInfo.trim() ? body.pageInfo.trim() : null;
  const batchLimit = Math.min(250, Math.max(1, Number(body?.batchLimit) || 100));
  const inactiveAfterMonths = Math.max(0, Number(body?.inactiveAfterMonths) || 60);

  await ensureContactShopifyCustomerSchema();

  let context;
  try {
    context = await getShopifyOperationContext({ businessId: session.businessId, channelInstanceId });
  } catch (error) {
    const message = error instanceof ShopifyOperationContextError ? error.message : 'Shopify storefront is unavailable.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (mode === 'push') {
    const contacts = await imsQuery<ImsContactRow>(
      `SELECT id, type, name, first_name, last_name, customer_code, notes, email, phone, mobile, is_active, promo_email, promo_sms, shopify_customer_id
       FROM ims_contacts
       WHERE business_id = ? AND type = 'retail_customer'
       ORDER BY id`,
      [session.businessId],
    );

    let synced = 0;
    let created = 0;
    let linked = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const contact of contacts) {
      const result = await syncRetailCustomerToShopify(contact, { businessId: session.businessId, channelInstanceId });
      if (!result.success) {
        if (result.action === 'skipped') skipped++;
        else errors++;
        continue;
      }
      synced++;
      if (result.action === 'created') created++;
      else if (result.action === 'linked') linked++;
      else if (result.action === 'updated') updated++;
    }

    return NextResponse.json({
      success: true,
      mode,
      synced,
      created,
      linked,
      updated,
      skipped,
      errors,
      total: contacts.length,
      ...(await getGiftCardLinkStats(session.businessId, channelInstanceId)),
    });
  }

  const shopify = new ShopifyService(context.credentials.shopDomain, context.credentials.token);
  const activeCustomerIds = new Set<string>();
  const activeMonthsCutoff = new Date();
  activeMonthsCutoff.setMonth(activeMonthsCutoff.getMonth() - inactiveAfterMonths);
  activeMonthsCutoff.setDate(1);
  activeMonthsCutoff.setHours(0, 0, 0, 0);

  if (inactiveAfterMonths > 0) {
    try {
      const recentOrders = await shopify.getOrdersForSync(inactiveAfterMonths);
      for (const order of recentOrders) {
        const customerId = String(order.customer?.id ?? '').trim();
        if (customerId) activeCustomerIds.add(customerId);
      }
    } catch (e: any) {
      return NextResponse.json({ error: scopeHint(`Shopify order activity lookup failed: ${e.message}`) }, { status: 502 });
    }
  }

  let customers: ShopifyCustomer[] = [];
  let nextPageInfo: string | null = null;
  try {
    const page = await shopify.getCustomerPage(pageInfo, batchLimit);
    customers = page.customers;
    nextPageInfo = page.nextPageInfo;
  } catch (e: any) {
    return NextResponse.json({ error: scopeHint(`Shopify API error: ${e.message}`) }, { status: 502 });
  }

  if (!customers.length) {
    return NextResponse.json({
      success: true,
      mode,
      synced: 0,
      created: 0,
      linked: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      total: 0,
      batchCount: 0,
      hasMore: Boolean(nextPageInfo),
      nextPageInfo,
      ...(!nextPageInfo ? await getGiftCardLinkStats(session.businessId, channelInstanceId) : {}),
    });
  }

  let synced = 0;
  let created = 0;
  let linked = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const customer of customers) {
    const shopifyCustomerId = String(customer.id);
    const email = normalizeString(customer.email);
    const firstName = normalizeString(customer.first_name);
    const lastName = normalizeString(customer.last_name);
    const phone = normalizeString(customer.phone);
    const name = customerName(customer);
    const createdAt = customer.created_at ? new Date(customer.created_at).getTime() : null;
    const activeByWindow = activeCustomerIds.has(shopifyCustomerId) || (createdAt != null && !Number.isNaN(createdAt) && createdAt >= activeMonthsCutoff.getTime());
    const isActive = customerActive(customer) === 0 ? 0 : (activeByWindow ? 1 : 0);

    try {
      const existingMapping = await getContactChannelMapping({
        businessId: session.businessId,
        channelInstanceId,
        externalCustomerId: shopifyCustomerId,
      });
      const byShopifyId = existingMapping?.mappingStatus === 'linked'
        ? await imsQuery<ImsContactRow>(
            'SELECT id, type, name, first_name, last_name, customer_code, notes, email, phone, mobile, is_active, promo_email, promo_sms, shopify_customer_id FROM ims_contacts WHERE business_id = ? AND id = ? LIMIT 1',
            [session.businessId, existingMapping.contactId],
          )
        : [];

      if (byShopifyId[0]) {
        const changed = await updateContact(byShopifyId[0].id, buildUpdate(byShopifyId[0], customer, activeMonthsCutoff, activeCustomerIds));
        synced++;
        if (changed) updated++;
        else skipped++;
        continue;
      }

      let emailMatch: ImsContactRow | undefined;
      if (email) {
        const byEmail = await imsQuery<ImsContactRow>(
          `SELECT id, type, name, first_name, last_name, customer_code, notes, email, phone, mobile, is_active, promo_email, promo_sms, shopify_customer_id
           FROM ims_contacts
           WHERE business_id = ? AND type <> 'supplier' AND LOWER(email) = LOWER(?)
           ORDER BY id
           LIMIT 2`,
          [session.businessId, email],
        );
        if (byEmail.length > 1) {
          skipped++;
          continue;
        }
        emailMatch = byEmail[0];
      }

      if (emailMatch) {
        const changed = await updateContact(emailMatch.id, buildUpdate(emailMatch, customer, activeMonthsCutoff, activeCustomerIds));
        const mapping = await recordInboundContactChannelMapping({
          businessId: session.businessId,
          channelInstanceId,
          contactId: emailMatch.id,
          externalCustomerId: shopifyCustomerId,
        });
        if (mapping.mappingStatus !== 'linked') {
          errors++;
          continue;
        }
        synced++;
        linked++;
        if (changed) updated++;
        else skipped++;
        continue;
      }

      const createdContact = await imsExecute(
        `INSERT INTO ims_contacts
           (business_id, type, name, first_name, last_name, customer_code, notes, email, phone, mobile, is_active, promo_email, promo_sms, price_tier)
         VALUES (?, 'retail_customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'retail')` ,
        [session.businessId, name, firstName, lastName, extractCustomerCode(customer), normalizeString(customer.note), email, phone, phone, isActive, marketingEmailFlag(customer) ?? 0, marketingSmsFlag(customer) ?? 0],
      );
      await recordInboundContactChannelMapping({
        businessId: session.businessId,
        channelInstanceId,
        contactId: Number(createdContact.insertId),
        externalCustomerId: shopifyCustomerId,
      });
      synced++;
      created++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({
    success: true,
    mode,
    synced,
    created,
    linked,
    updated,
    skipped,
    errors,
    total: customers.length,
    batchCount: customers.length,
    hasMore: Boolean(nextPageInfo),
    nextPageInfo,
    ...(!nextPageInfo ? await getGiftCardLinkStats(session.businessId, channelInstanceId) : {}),
  });
}