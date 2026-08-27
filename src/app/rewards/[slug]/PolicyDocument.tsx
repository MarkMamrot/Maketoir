import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { LoyaltyPortalProfileRepository } from '@/lib/loyalty/LoyaltyPortalProfile';
import styles from './policyDocument.module.css';

export async function PolicyDocument({ slug, kind, version }: { slug: string; kind: 'terms' | 'privacy'; version?: string }) {
  const policy = await LoyaltyPortalProfileRepository.getPublishedPolicyBySlug(slug, version);
  if (!policy) notFound();
  if (policy.policyMode === 'external') redirect(kind === 'terms' ? policy.termsUrl : policy.privacyUrl);
  const markdown = kind === 'terms' ? policy.termsMarkdown : policy.privacyMarkdown;
  if (!markdown) notFound();

  return (
    <main className={styles.shell}>
      <nav className={styles.nav} aria-label="Policy navigation">
        <Link className={styles.brand} href={`/rewards/${encodeURIComponent(slug)}`}>Rewards</Link>
        <div className={styles.navLinks}>
          <Link href={`/rewards/${encodeURIComponent(slug)}/${kind === 'terms' ? 'privacy' : 'terms'}?version=${encodeURIComponent(policy.version)}`}>
            {kind === 'terms' ? 'Privacy' : 'Rewards terms'}
          </Link>
        </div>
      </nav>
      <article className={styles.article}>
        <p className={styles.eyebrow}>Published policy · Version {policy.version}</p>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        <footer className={styles.footer}>Published {new Date(policy.publishedAt).toLocaleDateString('en-AU')}</footer>
      </article>
    </main>
  );
}