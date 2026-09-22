import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BusinessApplicationsRepository } from '@/lib/db/BusinessApplicationsRepository';

function getSuperAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s?.tier === 'SuperAdmin' ? s : null;
  } catch { return null; }
}

export async function GET(req: Request) {
  if (!getSuperAdminSession()) {
    return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });
  }
  const status = new URL(req.url).searchParams.get('status');
  const validStatus = status === 'pending_review' || status === 'approved' || status === 'rejected' ? status : undefined;
  const applications = await BusinessApplicationsRepository.list(validStatus);
  return NextResponse.json({ success: true, applications });
}
