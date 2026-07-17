import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { WholesaleSession } from '@/lib/wholesale/wholesaleSession';
import WholesalePortalClient from './_client';

function getSession(): WholesaleSession | null {
  const raw = cookies().get('wholesale_session')?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as WholesaleSession; } catch { return null; }
}

export default function WholesalePortalPage() {
  const session = getSession();
  if (!session) redirect('/wholesale/login');

  return <WholesalePortalClient session={session} />;
}
