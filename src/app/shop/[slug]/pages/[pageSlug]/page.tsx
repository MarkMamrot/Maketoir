import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OnlineShopPageRepository } from '@/lib/onlineShop/onlineShopPages';
import { OnlineShopProfileRepository } from '@/lib/onlineShop/onlineShopProfile';
import { SectionRenderer } from '../../components/SectionRenderer';
import styles from '../../Storefront.module.css';

async function resolve(slug: string, pageSlug: string) { const profile = await OnlineShopProfileRepository.getActiveBySlug(slug); if (!profile) return null;
  const page = await OnlineShopPageRepository.getPublishedBySlug(profile.businessId, pageSlug); return page ? { profile, page } : null; }
export async function generateMetadata({ params }: { params: { slug: string; pageSlug: string } }): Promise<Metadata> { const data = await resolve(params.slug, params.pageSlug); return data ? { title: data.page.metaTitle || `${data.page.title} | ${data.profile.displayName}`, description: data.page.metaDescription } : {}; }
export default async function ContentPage({ params }: { params: { slug: string; pageSlug: string } }) { const data = await resolve(params.slug, params.pageSlug); if (!data) notFound();
  return <div className={styles.content}><h1 className={styles.pageTitle}>{data.page.title}</h1><SectionRenderer storeSlug={data.profile.slug} sections={data.page.document.sections} /></div>; }