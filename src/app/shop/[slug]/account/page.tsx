import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { ONLINE_SHOP_SESSION_COOKIE, verifyOnlineShopSession } from '@/lib/onlineShop/onlineShopSession';
import { imsQuery } from '@/services/IMSMySQLService';
import { AccountLogoutButton } from './AccountLogoutButton';
import styles from '../Storefront.module.css';

export default async function OnlineShopAccountPage({ params }: { params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug); if (!profile) notFound();
  const session = verifyOnlineShopSession(cookies().get(ONLINE_SHOP_SESSION_COOKIE)?.value ?? '');
  if (!session || session.businessId !== profile.businessId || session.storeSlug !== profile.slug) redirect(`/shop/${profile.slug}/login`);
  const data = await runImsForBusiness(profile.businessId, async () => {
    const [contacts, orders] = await Promise.all([
      imsQuery<{ name: string; email: string; store_credit: number | string }>('SELECT name, email, store_credit FROM ims_contacts WHERE business_id = ? AND id = ? AND is_active = 1 LIMIT 1', [profile.businessId, session.contactId]),
      imsQuery<{ id: number; so_number: string; status: string; order_date: string; total_amount: number | string; location_name: string | null }>(
        `SELECT so.id, so.so_number, so.status, so.order_date, so.total_amount, l.name AS location_name
           FROM ims_sales_orders so LEFT JOIN ims_locations l ON l.id = so.location_id
          WHERE so.business_id = ? AND so.customer_id = ? AND so.sales_channel = 'native_shop'
          ORDER BY so.order_date DESC, so.id DESC LIMIT 100`, [profile.businessId, session.contactId]),
    ]);
    return { contact: contacts[0] ?? null, orders };
  });
  if (!data.contact) redirect(`/shop/${profile.slug}/login`);
  const money = (value: number | string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value) || 0);
  return <div className={styles.content}><div className={styles.catalogueHead}><div><h1>Account</h1><span>{data.contact.email}</span></div><AccountLogoutButton storeSlug={profile.slug} /></div>
    <div className={styles.accountSummary}><div><span>Store credit</span><strong>{money(data.contact.store_credit)}</strong></div><Link href={`/shop/${profile.slug}/products`}>Continue shopping</Link></div>
    <section><h2>Orders</h2>{data.orders.length ? <div className={styles.accountOrders}>{data.orders.map(order => <article key={order.id}><div><strong>{order.so_number}</strong><span>{order.order_date} · {order.location_name || 'Online'}</span></div><span>{order.status.replace(/_/g, ' ')}</span><b>{money(order.total_amount)}</b></article>)}</div> : <div className={styles.empty}>No native online orders yet.</div>}</section>
  </div>;
}