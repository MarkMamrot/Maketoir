import type { Metadata } from 'next';

import { PolicyDocument } from '../PolicyDocument';

export const metadata: Metadata = { title: 'Loyalty Program Privacy Policy' };

export default function LoyaltyPrivacyPage({ params, searchParams }: { params: { slug: string }; searchParams: { version?: string } }) {
  return <PolicyDocument slug={params.slug} kind="privacy" version={searchParams.version} />;
}