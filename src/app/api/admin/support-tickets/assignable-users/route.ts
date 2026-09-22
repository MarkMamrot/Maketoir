import { NextResponse } from 'next/server';

import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { listAssignableSupportUsers } from '@/lib/supportTickets';

export async function GET() {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const users = await listAssignableSupportUsers();
  return NextResponse.json({ success: true, users });
}
