import type { Metadata } from 'next';

import { PolicyDocument } from '../PolicyDocument';

export const metadata: Metadata = { title: 'Loyalty Program Terms' };

export default function LoyaltyTermsPage({ params, searchParams }: { params: { slug: string }; searchParams: { version?: string } }) {
  return <PolicyDocument slug={params.slug} kind="terms" version={searchParams.version} />;
}