import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { syncRetailCustomerToShopify } from '@/lib/ims/shopifyCustomerSync';
import { LoyaltyPortalProfileRepository } from '@/lib/loyalty/LoyaltyPortalProfile';
import { LoyaltyService } from '@/lib/loyalty/LoyaltyService';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool } from '@/services/IMSMySQLService';

const clean = (value: unknown, maxLength: number) => String(value ?? '').trim().slice(0, maxLength);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loyaltyProgram(businessId: string) {
  const settings = await LoyaltyService.getSettings(businessId);
  const active = settings.enabled && (!settings.startedAt || new Date().toISOString().slice(0, 10) >= settings.startedAt);
  const profile = await LoyaltyPortalProfileRepository.getByBusinessId(businessId);
  return {
    enabled: settings.enabled,
    active,
    programName: settings.programName,
    termsUrl: profile?.isActive ? profile.termsUrl : null,
    termsVersion: profile?.isActive ? profile.termsVersion : null,
    policyVersionId: profile?.isActive ? profile.currentPolicyVersionId : null,
  };
}

export async function GET() {
  const session = await getImsSession(['pos_session']);
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
  try {
    return NextResponse.json({ loyalty: await loyaltyProgram(session.businessId) });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'pos.customer',
      operation: 'get_customer_create_options',
      title: 'POS customer creation options could not be loaded',
      error,
    });
    return NextResponse.json({ error: 'Customer options could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getImsSession(['pos_session']);
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const firstName = clean(body?.firstName, 100);
  const lastName = clean(body?.lastName, 100);
  const email = clean(body?.email, 255).toLowerCase();
  const phone = clean(body?.phone, 50);
  const loyaltyMember = body?.loyaltyMember === true;
  if (!firstName) return NextResponse.json({ error: 'First name is required.' }, { status: 400 });
  if (email && !emailPattern.test(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (!email && !phone) return NextResponse.json({ error: 'Enter an email address or phone number.' }, { status: 400 });

  let program;
  try {
    program = await loyaltyProgram(session.businessId);
  } catch (error) {
    await reportRuntimeIssue({ businessId: session.businessId, source: 'pos.customer', operation: 'validate_loyalty_enrolment', title: 'POS customer loyalty enrolment could not be validated', error });
    return NextResponse.json({ error: 'Customer options could not be validated.' }, { status: 500 });
  }
  if (loyaltyMember && !program.active) {
    return NextResponse.json({ error: 'The loyalty program is not currently active.' }, { status: 409 });
  }

  const pool = getIMSPool();
  const connection = await pool.getConnection();
  let contactId = 0;
  const name = `${firstName} ${lastName}`.trim();
  try {
    await connection.beginTransaction();
    const duplicateConditions: string[] = [];
    const duplicateParams: unknown[] = [session.businessId];
    if (email) { duplicateConditions.push('LOWER(email) = ?'); duplicateParams.push(email); }
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits) {
      duplicateConditions.push("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = ?");
      duplicateParams.push(phoneDigits.replace(/^\+/, ''));
    }
    const [duplicates] = await connection.execute(
      `SELECT id, name, is_active FROM ims_contacts
        WHERE business_id = ? AND type IN ('retail_customer','b2b_customer','both')
          AND (${duplicateConditions.join(' OR ')}) LIMIT 1 FOR UPDATE`,
      duplicateParams,
    );
    if ((duplicates as unknown[]).length) {
      await connection.rollback();
      return NextResponse.json({ error: 'A customer with this email or phone already exists. Search for and select that customer instead.' }, { status: 409 });
    }

    const [result] = await connection.execute(
      `INSERT INTO ims_contacts
        (business_id, type, name, first_name, last_name, email, phone, country, is_active,
         store_credit, price_tier, loyalty_member, loyalty_member_enrolled_at, loyalty_member_opted_out_at)
       VALUES (?, 'retail_customer', ?, ?, ?, ?, ?, 'Australia', 1, 0, 'retail', ?, IF(? = 1, NOW(), NULL), NULL)`,
      [session.businessId, name, firstName, lastName || null, email || null, phone || null, loyaltyMember ? 1 : 0, loyaltyMember ? 1 : 0],
    );
    contactId = Number((result as { insertId: number }).insertId);
    await connection.execute(
      `UPDATE ims_contacts SET customer_code = CONCAT('C-', LPAD(?, 6, '0')) WHERE id = ? AND business_id = ?`,
      [contactId, contactId, session.businessId],
    );
    if (loyaltyMember) {
      await connection.execute(
        `INSERT INTO loyalty_membership_events
          (business_id, contact_id, action, source, terms_version, policy_version_id)
         VALUES (?, ?, 'enrolled', 'pos', ?, ?)`,
        [session.businessId, contactId, program.termsVersion, program.policyVersionId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'pos.customer',
      operation: 'create_customer',
      title: 'POS customer could not be created',
      error,
      context: { loyaltyMember },
    });
    return NextResponse.json({ error: 'Customer could not be created.' }, { status: 500 });
  } finally {
    connection.release();
  }

  const contact = { id: contactId, type: 'retail_customer', is_active: 1, name, first_name: firstName, last_name: lastName || null, email: email || null, phone: phone || null };
  const shopifySync = await syncRetailCustomerToShopify(contact, session.businessId);
  if (shopifySync.action === 'error') {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'pos.customer',
      operation: 'sync_new_customer_to_shopify',
      title: 'New POS customer could not be synced to Shopify',
      error: new Error(shopifySync.reason),
      context: { contactId },
      reference: { type: 'ims_contact', id: contactId },
    }).catch(() => {});
  }
  await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({ businessId: session.businessId, contactId });

  return NextResponse.json({
    success: true,
    customer: { id: contactId, name, email: email || null, phone: phone || null, store_credit: 0, is_active: true },
    shopifySync,
  }, { status: 201 });
}