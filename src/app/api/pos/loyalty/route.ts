import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { LoyaltyService } from '@/lib/loyalty/LoyaltyService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET(req: Request) {
  const session = await getImsSession(['pos_session']);
  if (!session?.businessId) return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });

  const contactId = Number(new URL(req.url).searchParams.get('contact_id'));
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ error: 'A valid customer is required.' }, { status: 400 });
  }

  try {
    const contacts = await imsQuery<{ loyalty_member: number }>(
      `SELECT loyalty_member
         FROM ims_contacts
        WHERE id = ? AND business_id = ? AND is_active = 1
        LIMIT 1`,
      [contactId, session.businessId],
    );
    const contact = contacts[0];
    if (!contact) return NextResponse.json({ error: 'Customer not found.' }, { status: 404 });

    const settings = await LoyaltyService.getSettings(session.businessId);
    const member = Boolean(contact.loyalty_member);
    const active = settings.enabled && (!settings.startedAt || new Date().toISOString().slice(0, 10) >= settings.startedAt);
    const [account, rewards] = member
      ? await Promise.all([
          LoyaltyRepository.getAccount(session.businessId, contactId),
          active ? LoyaltyRepository.listRewards(session.businessId) : Promise.resolve([]),
        ])
      : [null, []];

    return NextResponse.json({
      loyalty: {
        enabled: settings.enabled,
        active,
        member,
        programName: settings.programName,
        pointsLabel: settings.pointsLabel,
        balancePoints: account?.balancePoints ?? 0,
        rewards,
      },
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: 'loyalty',
      operation: 'get_pos_customer_summary',
      title: 'POS loyalty summary failed',
      error,
      context: { contactId },
      reference: { type: 'ims_contact', id: contactId },
    });
    return NextResponse.json({ error: 'Could not load loyalty details.' }, { status: 500 });
  }
}