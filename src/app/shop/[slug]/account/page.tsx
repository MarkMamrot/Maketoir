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
      imsQuery<{ name: string; email: string; store_credit: number | string; loyalty_points: number | string }>(
        `SELECT c.name, c.email, c.store_credit, COALESCE(la.balance_points, 0) AS loyalty_points
           FROM ims_contacts c
           LEFT JOIN loyalty_accounts la ON la.business_id = c.business_id AND la.contact_id = c.id AND la.status = 'active'
          WHERE c.business_id = ? AND c.id = ? AND c.is_active = 1 LIMIT 1`,
        [profile.businessId, session.contactId],
      ),
      imsQuery<{ id: number; so_number: string; status: string; order_date: string; total_amount: number | string; location_name: string | null }>(
        `SELECT so.id, so.so_number, so.status, so.order_date, so.total_amount, l.name AS location_name
           FROM ims_sales_orders so LEFT JOIN ims_locations l ON l.id = so.location_id
          WHERE so.business_id = ? AND so.customer_id = ? AND so.sales_channel = 'native_shop'
          ORDER BY so.order_date DESC, so.id DESC LIMIT 100`, [profile.businessId, session.contactId]),
    ]);
    const orderIds = orders.map(order => Number(order.id));
    const tracking = orderIds.length ? await imsQuery<{
      so_id: number; provider: string; tracking_number: string; tracking_url: string | null;
    }>(
      `SELECT shipping.so_id, shipping.provider,
              COALESCE(NULLIF(parcel.article_id, ''), NULLIF(parcel.consignment_id, '')) AS tracking_number,
              parcel.tracking_url
         FROM ims_shipping_shipments shipping
         JOIN ims_shipping_parcels parcel
           ON parcel.shipment_id = shipping.id AND parcel.business_id = shipping.business_id
         JOIN ims_sales_orders sales_order
           ON sales_order.id = shipping.so_id AND sales_order.business_id = shipping.business_id
        WHERE shipping.business_id = ? AND shipping.so_id IN (${orderIds.map(() => '?').join(',')})
          AND shipping.ims_fulfilled_at IS NOT NULL
          AND sales_order.customer_id = ? AND sales_order.sales_channel = 'native_shop'
          AND COALESCE(NULLIF(parcel.article_id, ''), NULLIF(parcel.consignment_id, '')) IS NOT NULL
        ORDER BY shipping.id, parcel.parcel_number`,
      [profile.businessId, ...orderIds, session.contactId],
    ) : [];
    return {
      contact: contacts[0] ?? null,
      orders: orders.map(order => ({ ...order, tracking: tracking.filter(item => Number(item.so_id) === Number(order.id)) })),
    };
  });
  if (!data.contact) redirect(`/shop/${profile.slug}/login`);
  const money = (value: number | string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value) || 0);
  return <div className={styles.content}><div className={styles.catalogueHead}><div><h1>Account</h1><span>{data.contact.email}</span></div><AccountLogoutButton storeSlug={profile.slug} /></div>
    <div className={styles.accountSummary}><div><span>Store credit</span><strong>{money(data.contact.store_credit)}</strong></div><div><span>Loyalty points</span><strong>{Number(data.contact.loyalty_points).toLocaleString()}</strong></div><Link href={`/shop/${profile.slug}/products`}>Continue shopping</Link></div>
    <section><h2>Orders</h2>{data.orders.length ? <div className={styles.accountOrders}>{data.orders.map(order => <article key={order.id}><div><strong>{order.so_number}</strong><span>{order.order_date} · {order.location_name || 'Online'}</span>{order.tracking.map(item => <a key={`${item.provider}-${item.tracking_number}`} href={item.tracking_url || undefined} className={styles.orderTracking} target="_blank" rel="noreferrer">{item.provider === 'auspost_eparcel' ? 'Australia Post' : item.provider} · {item.tracking_number}</a>)}</div><span>{order.status.replace(/_/g, ' ')}</span><b>{money(order.total_amount)}</b></article>)}</div> : <div className={styles.empty}>No native online orders yet.</div>}</section>
  </div>;
}