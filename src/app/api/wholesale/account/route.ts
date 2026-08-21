import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import type { WholesaleAccountProfile } from '@/lib/wholesale/wholesaleAccountProfile';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

type AddressInput = {
  address: string | null;
  address2: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string;
};

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  return normalized || null;
}

function parseAddress(value: unknown, label: string): AddressInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} address is required.`);
  const input = value as Record<string, unknown>;
  const country = optionalText(input.country, `${label} country`, 100) || 'Australia';
  return {
    address: optionalText(input.address, `${label} address`, 255),
    address2: optionalText(input.address2, `${label} address line 2`, 255),
    suburb: optionalText(input.suburb, `${label} suburb`, 100),
    city: optionalText(input.city, `${label} city`, 100),
    state: optionalText(input.state, `${label} state`, 100),
    postcode: optionalText(input.postcode, `${label} postcode`, 30),
    country,
  };
}

export async function GET() {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;

  return runImsForBusiness(session.businessId, async () => {
    try {
      const rows = await imsQuery<any>(
        `SELECT wc.id AS company_id, wc.company_name, wc.tax_id, wc.payment_terms, wc.on_account_limit,
                wl.id AS location_id, wl.location_name, wl.is_primary,
                wl.billing_address, wl.billing_address2, wl.billing_suburb, wl.billing_city,
                wl.billing_state, wl.billing_postcode, wl.billing_country,
                wl.shipping_address, wl.shipping_address2, wl.shipping_suburb, wl.shipping_city,
                wl.shipping_state, wl.shipping_postcode, wl.shipping_country,
                wm.id AS member_id, wm.role AS member_role
           FROM ims_wholesale_company_members wm
           JOIN ims_wholesale_companies wc
             ON wc.id = wm.company_id AND wc.business_id = wm.business_id AND wc.status = 'active'
           JOIN ims_wholesale_company_locations wl
             ON wl.id = wm.location_id AND wl.company_id = wm.company_id
            AND wl.business_id = wm.business_id AND wl.status = 'active'
          WHERE wm.id = ? AND wm.business_id = ? AND wm.contact_id = ?
            AND wm.company_id = ? AND wm.location_id = ? AND wm.is_active = 1
          LIMIT 1`,
        [session.memberId, session.businessId, session.contactId, session.companyId, session.locationId],
      );
      const row = rows[0];
      if (!row) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

      const profile: WholesaleAccountProfile = {
        company: {
          id: Number(row.company_id),
          name: row.company_name,
          taxId: row.tax_id ?? null,
          paymentTerms: row.payment_terms ?? null,
          onAccountLimit: row.on_account_limit === null ? null : Number(row.on_account_limit),
        },
        location: {
          id: Number(row.location_id),
          name: row.location_name,
          isPrimary: Boolean(row.is_primary),
          billingAddress: {
            address: row.billing_address ?? null, address2: row.billing_address2 ?? null,
            suburb: row.billing_suburb ?? null, city: row.billing_city ?? null,
            state: row.billing_state ?? null, postcode: row.billing_postcode ?? null,
            country: row.billing_country || 'Australia',
          },
          shippingAddress: {
            address: row.shipping_address ?? null, address2: row.shipping_address2 ?? null,
            suburb: row.shipping_suburb ?? null, city: row.shipping_city ?? null,
            state: row.shipping_state ?? null, postcode: row.shipping_postcode ?? null,
            country: row.shipping_country || 'Australia',
          },
        },
        member: { id: Number(row.member_id), role: row.member_role },
      };
      return NextResponse.json({ success: true, profile });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'load_account_profile',
        title: 'Wholesale account profile could not be loaded',
        error,
        reference: { type: 'wholesale_member', id: session.memberId },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: 'Account details could not be loaded.' }, { status: 500 });
    }
  });
}

export async function PUT(request: Request) {
  const { session, response } = await requireActiveWholesaleSession();
  if (response) return response;
  if (session.memberRole !== 'owner' && session.memberRole !== 'admin') {
    return NextResponse.json({ error: 'Only company owners and admins can update account addresses.' }, { status: 403 });
  }

  let billingAddress: AddressInput;
  let shippingAddress: AddressInput;
  try {
    const body = await request.json();
    billingAddress = parseAddress(body.billingAddress, 'Billing');
    shippingAddress = parseAddress(body.shippingAddress, 'Shipping');
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid account details.' },
      { status: 400 },
    );
  }

  return runImsForBusiness(session.businessId, async () => {
    try {
      const result = await imsExecute(
        `UPDATE ims_wholesale_company_locations wl
            JOIN ims_wholesale_company_members wm
              ON wm.id = ? AND wm.business_id = wl.business_id
             AND wm.company_id = wl.company_id AND wm.location_id = wl.id
             AND wm.contact_id = ? AND wm.is_active = 1
           SET wl.billing_address = ?, wl.billing_address2 = ?, wl.billing_suburb = ?,
               wl.billing_city = ?, wl.billing_state = ?, wl.billing_postcode = ?, wl.billing_country = ?,
               wl.shipping_address = ?, wl.shipping_address2 = ?, wl.shipping_suburb = ?,
               wl.shipping_city = ?, wl.shipping_state = ?, wl.shipping_postcode = ?, wl.shipping_country = ?
         WHERE wl.id = ? AND wl.business_id = ? AND wl.company_id = ? AND wl.status = 'active'`,
        [session.memberId, session.contactId,
          billingAddress.address, billingAddress.address2, billingAddress.suburb, billingAddress.city,
          billingAddress.state, billingAddress.postcode, billingAddress.country,
          shippingAddress.address, shippingAddress.address2, shippingAddress.suburb, shippingAddress.city,
          shippingAddress.state, shippingAddress.postcode, shippingAddress.country,
          session.locationId, session.businessId, session.companyId],
      );
      if (!Number((result as any).affectedRows)) {
        const matches = await imsQuery<{ id: number }>(
          `SELECT wl.id
             FROM ims_wholesale_company_locations wl
             JOIN ims_wholesale_company_members wm
               ON wm.id = ? AND wm.business_id = wl.business_id
              AND wm.company_id = wl.company_id AND wm.location_id = wl.id
              AND wm.contact_id = ? AND wm.is_active = 1
            WHERE wl.id = ? AND wl.business_id = ? AND wl.company_id = ? AND wl.status = 'active'
            LIMIT 1`,
          [session.memberId, session.contactId, session.locationId, session.businessId, session.companyId],
        );
        if (!matches[0]) {
          return NextResponse.json({ error: 'Your assigned buying location is no longer available.' }, { status: 409 });
        }
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: 'wholesale_portal',
        operation: 'update_account_addresses',
        title: 'Wholesale account addresses could not be updated',
        error,
        reference: { type: 'wholesale_location', id: session.locationId },
      }).catch(() => {});
      return NextResponse.json({ success: false, error: 'Account addresses could not be updated.' }, { status: 500 });
    }
  });
}