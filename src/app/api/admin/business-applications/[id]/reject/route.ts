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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = getSuperAdminSession();
  if (!session) return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid application id.' }, { status: 400 });

  const application = await BusinessApplicationsRepository.findById(id);
  if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  if (application.status !== 'pending_review') {
    return NextResponse.json({ error: `Application is already ${application.status}.` }, { status: 409 });
  }

  const { reason } = await req.json().catch(() => ({}));
  const trimmedReason = String(reason ?? '').trim();
  if (!trimmedReason) return NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 });

  await BusinessApplicationsRepository.reject(id, { userId: session.userId, name: session.name }, trimmedReason);
  return NextResponse.json({ success: true });
}
