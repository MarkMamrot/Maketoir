import type { Metadata } from 'next';
import LandingPreview from './LandingPreview';

export const metadata: Metadata = {
  title: 'Solvantis | Retail and Wholesale',
  description: 'Connected stock, POS, online storefronts, wholesale orders and daily store operations. Built with Australian retailers and wholesalers.',
  robots: { index: false, follow: false },
};

export default function LandingTwoPage() {
  return <LandingPreview />;
}