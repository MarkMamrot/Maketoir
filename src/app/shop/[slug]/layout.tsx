import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OnlineShopPageRepository } from '@/lib/onlineShop/onlineShopPages';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { CartLink } from './components/CartLink';
import styles from './Storefront.module.css';

export default async function ShopLayout({ children, params }: { children: React.ReactNode; params: { slug: string } }) {
  const profile = await OnlineShopProfileRepository.getActiveBySlug(params.slug); if (!profile) notFound();
  const pages = await OnlineShopPageRepository.listPublishedNavigation(profile.businessId);
  return <div className={styles.shell}><header className={styles.header}><Link className={styles.brand} href={`/shop/${profile.slug}`}>{profile.logoUrl && <img src={profile.logoUrl} alt="" />}{profile.displayName}</Link>
    <nav className={styles.nav}><Link href={`/shop/${profile.slug}/products`}>Shop</Link>{pages.filter(page => ['header', 'both'].includes(page.navigationLocation)).map(page => <Link key={page.pageId} href={`/shop/${profile.slug}/pages/${page.slug}`}>{page.navigationLabel || page.title}</Link>)}</nav>
    <div className={styles.tools}><CartLink storeSlug={profile.slug} /></div></header><main className={styles.main}>{children}</main>
    <footer className={styles.footer}><strong>{profile.displayName}</strong><nav>{pages.filter(page => ['footer', 'both'].includes(page.navigationLocation)).map(page => <Link key={page.pageId} href={`/shop/${profile.slug}/pages/${page.slug}`}>{page.navigationLabel || page.title}</Link>)}</nav></footer></div>;
}