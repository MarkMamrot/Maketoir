/**
 * POST /api/admin/onboard — SuperAdmin only.
 *
 * One-shot business onboarding:
 *   1. Create the business row (with module access flags).
 *   2. If IMS is enabled, provision a dedicated IMS schema on the shared MySQL
 *      server (CREATE DATABASE + schema DDL + business_id triggers) and record
 *      businesses.ims_db_name.
 *   3. Optionally seed an owner (Admin) user bound to the new business.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { execute } from '@/services/MySQLService';
import { UsersRepository } from '@/lib/db/UsersRepository';
import { provisionBusinessIms, deriveImsDbName } from '@/lib/ims/provisionBusiness';

function getSuperAdminSession() {
  const raw = cookies().get('marketoir_session')?.value;
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s?.tier === 'SuperAdmin' ? s : null;
  } catch { return null; }
}

export async function POST(req: Request) {
  if (!getSuperAdminSession()) {
    return NextResponse.json({ error: 'SuperAdmin access required.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name: string = (body?.name ?? '').trim();
  const hasForesight = body?.hasForesight !== false;
  const hasIms       = body?.hasIms !== false;
  const hasPos       = body?.hasPos !== false;
  const imsDbName: string | undefined = body?.imsDbName?.trim() || undefined;
  const ownerEmail: string | undefined = body?.ownerEmail?.trim() || undefined;
  const ownerPassword: string | undefined = body?.ownerPassword || undefined;
  const ownerName: string | undefined = body?.ownerName?.trim() || undefined;

  if (!name) return NextResponse.json({ error: 'Business name is required.' }, { status: 400 });
  if (ownerEmail && !ownerPassword) {
    return NextResponse.json({ error: 'Owner password is required when an owner email is given.' }, { status: 400 });
  }
  // Validate derived/explicit schema name up front so we fail before creating rows.
  let resolvedDbName: string | null = null;
  if (hasIms) {
    try { resolvedDbName = imsDbName ? imsDbName.replace(/[^a-zA-Z0-9_]/g, '') : deriveImsDbName(name); }
    catch (e: any) { return NextResponse.json({ error: e?.message ?? 'Invalid IMS schema name.' }, { status: 400 }); }
    if (!resolvedDbName) return NextResponse.json({ error: 'Could not derive a valid IMS schema name.' }, { status: 400 });
  }

  const businessId = `biz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const steps: string[] = [];

  try {
    // 1. Business row.
    await execute(
      `INSERT INTO businesses (business_id, name, has_foresight, has_ims, has_pos)
       VALUES (?, ?, ?, ?, ?)`,
      [businessId, name, hasForesight ? 1 : 0, hasIms ? 1 : 0, hasPos ? 1 : 0],
    );
    steps.push(`Created business "${name}"`);

    // 2. IMS schema.
    let imsResult: { imsDbName: string } | null = null;
    if (hasIms && resolvedDbName) {
      imsResult = await provisionBusinessIms({ businessId, businessName: name, imsDbName: resolvedDbName });
      steps.push(`Provisioned IMS schema ${imsResult.imsDbName}`);
    }

    // 3. Optional owner user.
    let ownerCreated = false;
    if (ownerEmail && ownerPassword) {
      const existing = await UsersRepository.findByEmail(ownerEmail).catch(() => null);
      if (existing) {
        steps.push(`⚠ Owner user ${ownerEmail} already exists — skipped`);
      } else {
        await UsersRepository.create({
          email: ownerEmail,
          password: ownerPassword,
          name: ownerName ?? undefined,
          businessId,
          role: 'admin',
          tier: 'Admin',
        });
        ownerCreated = true;
        steps.push(`Created owner ${ownerEmail} (Admin)`);
      }
    }

    return NextResponse.json({
      success: true,
      businessId,
      imsDbName: imsResult?.imsDbName ?? null,
      ownerCreated,
      steps,
    });
  } catch (err: any) {
    console.error('[onboard] error:', err?.message, err?.stack);
    return NextResponse.json({
      success: false,
      businessId,
      steps,
      error: `${err?.message ?? 'Onboarding failed'}${steps.length ? ` (completed: ${steps.join('; ')})` : ''}`,
    }, { status: 500 });
  }
}
