import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

const VALID_SOURCES = ['cin7', 'solvantis'] as const;
type InventorySource = typeof VALID_SOURCES[number];

function getBusinessId(): string | null {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) return null;
    const { businessId } = JSON.parse(session.value);
    return businessId ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const businessId = getBusinessId();
  if (!businessId) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }
  const source = (await ConfigRepository.get(businessId, 'inventory_source').catch(() => null)) ?? 'cin7';
  return NextResponse.json({ success: true, source });
}

export async function POST(req: Request) {
  const businessId = getBusinessId();
  if (!businessId) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const source = String(body?.source ?? '').trim() as InventorySource;
  if (!VALID_SOURCES.includes(source)) {
    return NextResponse.json(
      { success: false, error: `Invalid source. Allowed: ${VALID_SOURCES.join(', ')}.` },
      { status: 400 },
    );
  }
  await ConfigRepository.set(businessId, 'inventory_source', source);
  return NextResponse.json({ success: true, source });
}
