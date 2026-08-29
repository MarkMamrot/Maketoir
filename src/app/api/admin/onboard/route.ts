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
import {
  cleanupFailedBusinessProvision,
  ImsProvisioningError,
  provisionBusinessIms,
} from '@/lib/ims/provisionBusiness';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

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
  if (imsDbName && !/^[a-zA-Z0-9_]{1,60}$/.test(imsDbName)) {
    return NextResponse.json({ error: 'IMS schema name may contain only letters, numbers, and underscores.' }, { status: 400 });
  }

  const businessId = `biz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const steps: string[] = [];
  let businessCreated = false;
  let provisionedDbName: string | null = null;
  let schemaCreated = false;

  try {
    // 1. Business row.
    await execute(
      `INSERT INTO businesses (business_id, name, has_foresight, has_ims, has_pos)
       VALUES (?, ?, ?, ?, ?)`,
      [businessId, name, hasForesight ? 1 : 0, hasIms ? 1 : 0, hasPos ? 1 : 0],
    );
    businessCreated = true;
    steps.push(`Created business "${name}"`);
    await execute(
      `INSERT INTO business_ai_accounts (business_id, plan_key, funding_mode, enforcement_mode, cycle_mode)
       VALUES (?, 'starter', 'prepaid', 'observe', 'manual')`,
      [businessId],
    );
    steps.push('Created observe-mode AI account');

    // 2. IMS schema.
    let imsResult: { imsDbName: string } | null = null;
    if (hasIms) {
      imsResult = await provisionBusinessIms({ businessId, businessName: name, imsDbName });
      provisionedDbName = imsResult.imsDbName;
      schemaCreated = imsResult.schemaCreated;
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
    if (err instanceof ImsProvisioningError) {
      provisionedDbName = err.imsDbName;
      schemaCreated = err.schemaCreated;
    }
    await execute('DELETE FROM business_ai_accounts WHERE business_id = ?', [businessId]).catch(() => {});
    const cleanup = await cleanupFailedBusinessProvision({
      businessId,
      imsDbName: provisionedDbName,
      schemaCreated,
      businessCreated,
    });
    await reportRuntimeIssue({
      businessId,
      source: 'admin_onboard',
      operation: cleanup.errors.length > 0 ? 'provision_cleanup_failed' : 'provision_failed',
      severity: cleanup.errors.length > 0 ? 'critical' : 'error',
      title: cleanup.errors.length > 0
        ? 'Admin business provisioning cleanup failed'
        : 'Admin business provisioning failed',
      error: err,
      context: {
        imsDbName: provisionedDbName,
        schemaCreated,
        businessCreated,
        completedSteps: steps,
        schemaDropped: cleanup.schemaDropped,
        businessDeleted: cleanup.businessDeleted,
        cleanupErrors: cleanup.errors,
      },
    });
    return NextResponse.json({
      success: false,
      businessId,
      steps,
      cleanup: {
        schemaDropped: cleanup.schemaDropped,
        businessDeleted: cleanup.businessDeleted,
        complete: cleanup.errors.length === 0,
      },
      error: err?.message ?? 'Onboarding failed',
    }, { status: 500 });
  }
}
