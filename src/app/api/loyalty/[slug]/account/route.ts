import { NextResponse } from 'next/server';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { getLoyaltyPortalAuth } from '@/lib/loyalty/LoyaltyPortalAuth';
import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { LoyaltyService } from '@/lib/loyalty/LoyaltyService';
import { ShopifyLoyaltyMetafieldService } from '@/lib/loyalty/ShopifyLoyaltyMetafieldService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';

export async function GET(_: Request, { params }: { params: { slug: string } }) {
  const auth = await getLoyaltyPortalAuth(params.slug);
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  try {
    return await runImsForBusiness(auth.profile.businessId, async () => {
      const contacts = await imsQuery<{ loyalty_member: number; name: string }>(
        `SELECT loyalty_member, name FROM ims_contacts WHERE id=? AND business_id=? AND shopify_customer_id IS NOT NULL AND is_active=1 LIMIT 1`,
        [auth.session.contactId, auth.profile.businessId]);
      if (!contacts[0]) return NextResponse.json({ error: 'Customer not found.' }, { status: 403 });
      const settings = await LoyaltyService.getSettings(auth.profile.businessId);
      const [account, rewards, history, redemptions] = await Promise.all([
        LoyaltyRepository.getAccount(auth.profile.businessId, auth.session.contactId),
        LoyaltyRepository.listRewards(auth.profile.businessId),
        imsQuery<any>(`SELECT t.type, t.points_delta, t.balance_after, t.reason, t.created_at FROM loyalty_transactions t JOIN loyalty_accounts a ON a.id=t.account_id AND a.business_id=t.business_id WHERE t.business_id=? AND a.contact_id=? ORDER BY t.created_at DESC, t.id DESC LIMIT 100`, [auth.profile.businessId, auth.session.contactId]),
        imsQuery<any>(`SELECT r.id, r.status, r.points_deducted, r.voucher_code, r.expires_at, r.used_at, r.created_at, rw.display_name, rw.value_aud FROM loyalty_redemptions r JOIN loyalty_accounts a ON a.id=r.account_id AND a.business_id=r.business_id JOIN loyalty_rewards rw ON rw.id=r.reward_id AND rw.business_id=r.business_id WHERE r.business_id=? AND a.contact_id=? AND r.shopify_discount_id IS NOT NULL ORDER BY r.created_at DESC LIMIT 50`, [auth.profile.businessId, auth.session.contactId]),
      ]);
      return NextResponse.json({ profile: auth.profile, customer: { name: contacts[0].name, email: auth.session.email }, loyalty: { enabled: settings.enabled, member: Boolean(contacts[0].loyalty_member), programName: settings.programName, pointsLabel: settings.pointsLabel, balancePoints: account?.balancePoints ?? 0, lifetimeEarned: account?.lifetimeEarned ?? 0, lifetimeRedeemed: account?.lifetimeRedeemed ?? 0, rewards, history, redemptions } });
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.profile.businessId, source: 'loyalty_portal', operation: 'load_account', title: 'Loyalty portal account could not be loaded', error, context: { contactId: auth.session.contactId }, reference: { type: 'ims_contact', id: auth.session.contactId } }).catch(() => {});
    return NextResponse.json({ error: 'Rewards account could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  const auth = await getLoyaltyPortalAuth(params.slug);
  if (!auth) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'A valid JSON body is required.' }, { status: 400 }); }
  const action = body?.action;
  if (action !== 'enrol' && action !== 'opt_out') return NextResponse.json({ error: 'A valid membership action is required.' }, { status: 400 });
  if (action === 'enrol' && (body?.acceptedTerms !== true || body?.termsVersion !== auth.profile.termsVersion)) return NextResponse.json({ error: 'Accept the current loyalty terms to enrol.' }, { status: 400 });
  try {
    const result = await runImsForBusiness(auth.profile.businessId, async () => {
      const connection = await getIMSPool().getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute<any[]>(
          `SELECT loyalty_member FROM ims_contacts WHERE id=? AND business_id=? AND shopify_customer_id IS NOT NULL AND is_active=1 FOR UPDATE`,
          [auth.session.contactId, auth.profile.businessId]);
        if (!rows[0]) { await connection.rollback(); return { found: false, changed: false }; }
        const member = Boolean(rows[0].loyalty_member);
        const nextMember = action === 'enrol';
        if (member === nextMember) { await connection.commit(); return { found: true, changed: false }; }
        await connection.execute(
          nextMember
            ? `UPDATE ims_contacts SET loyalty_member=1, loyalty_member_enrolled_at=NOW(), loyalty_member_opted_out_at=NULL WHERE id=? AND business_id=?`
            : `UPDATE ims_contacts SET loyalty_member=0, loyalty_member_opted_out_at=NOW() WHERE id=? AND business_id=?`,
          [auth.session.contactId, auth.profile.businessId]);
        if (nextMember) await connection.execute(`INSERT INTO loyalty_accounts (business_id,contact_id,status) VALUES (?,?,'active') ON DUPLICATE KEY UPDATE status='active'`, [auth.profile.businessId, auth.session.contactId]);
        await connection.execute(`INSERT INTO loyalty_membership_events (business_id,contact_id,action,source,terms_version) VALUES (?,?,?,'loyalty_portal',?)`, [auth.profile.businessId, auth.session.contactId, nextMember ? 'enrolled' : 'opted_out', nextMember ? auth.profile.termsVersion : null]);
        await connection.commit();
        return { found: true, changed: true };
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    });
    if (!result.found) return NextResponse.json({ error: 'Customer not found.' }, { status: 403 });
    if (result.changed) await runImsForBusiness(auth.profile.businessId, () => ShopifyLoyaltyMetafieldService.syncConfiguredCustomer({ businessId: auth.profile.businessId, contactId: auth.session.contactId }));
    return NextResponse.json({ success: true, member: action === 'enrol' });
  } catch (error) {
    await reportRuntimeIssue({ businessId: auth.profile.businessId, source: 'loyalty_portal', operation: 'update_membership', title: 'Loyalty portal membership could not be updated', error, context: { contactId: auth.session.contactId, action }, reference: { type: 'ims_contact', id: auth.session.contactId } }).catch(() => {});
    return NextResponse.json({ error: 'Membership could not be updated.' }, { status: 500 });
  }
}