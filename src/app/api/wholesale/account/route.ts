import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import type { WholesaleAccountProfile } from '@/lib/wholesale/wholesaleAccountProfile';
import { requireActiveWholesaleSession } from '@/lib/wholesale/wholesaleSession';
import { imsQuery } from '@/services/IMSMySQLService';

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