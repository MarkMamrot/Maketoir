import type { Metadata } from 'next';
import { DM_Sans, Lora } from 'next/font/google';
import styles from './syncbooks.module.css';

const body = DM_Sans({ subsets: ['latin'], variable: '--font-body' });
const display = Lora({ subsets: ['latin'], variable: '--font-display' });
export const metadata: Metadata = {
  title: 'SyncBooks | Bookkeeping for Australian businesses',
  description: 'Bookkeeping matched to your business. Discuss local, overseas or blended support, payroll, reconciliations and BAS-ready records.',
};

export default function SyncBooksLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${styles.site} ${body.variable} ${display.variable}`}>{children}</div>;
}