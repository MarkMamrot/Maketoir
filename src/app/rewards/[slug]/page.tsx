import { notFound } from 'next/navigation';
import { LoyaltyPortalProfileRepository } from '@/lib/loyalty/LoyaltyPortalProfile';
import { LoyaltyPortalClient } from './LoyaltyPortalClient';
import styles from './loyaltyPortal.module.css';

export default async function LoyaltyPortalPage({ params }: { params: { slug: string } }) {
  const profile = await LoyaltyPortalProfileRepository.getActiveBySlug(params.slug);
  if (!profile) notFound();
  return <main className={styles.shell}><LoyaltyPortalClient slug={profile.slug} publicProfile={{ displayName: profile.displayName, logoUrl: profile.logoUrl, termsUrl: profile.termsUrl, privacyUrl: profile.privacyUrl }} /></main>;
}