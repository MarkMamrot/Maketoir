import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  ContactMergeNotFoundError,
  ContactMergeValidationError,
  mergeCustomerContacts,
} from '@/lib/ims/contactDataQualityService';
import { syncRetailCustomerToShopify } from '@/lib/ims/shopifyCustomerSync';
import { ImsContactsRepo } from '@/lib/ims/ImsRepository';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ success: false, error: 'Advisor accounts are read-only.' }, { status: 403 });
  const businessId = String(session.businessId);
  try {
    const body = await request.json();
    const result = await mergeCustomerContacts({
      businessId,
      sourceContactId: Number(body.sourceContactId),
      targetContactId: Number(body.targetContactId),
      actor: { id: session.userId == null ? null : Number(session.userId), name: String(session.name || session.email || 'Unknown user') },
    });
    const target = await ImsContactsRepo.get(result.targetContactId, businessId);
    const shopifySync = target ? await syncRetailCustomerToShopify(target, businessId) : null;
    await ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({ businessId, contactId: result.targetContactId });
    return NextResponse.json({ success: true, data: result, shopifySync });
  } catch (error) {
    if (error instanceof ContactMergeValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    }
    if (error instanceof ContactMergeNotFoundError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }
    await reportRuntimeIssue({
      businessId, source: 'ims_crm', operation: 'merge_contacts', title: 'Contact merge failed', error,
    }).catch(() => {});
    return NextResponse.json({ success: false, error: 'Contacts could not be merged.' }, { status: 500 });
  }
}