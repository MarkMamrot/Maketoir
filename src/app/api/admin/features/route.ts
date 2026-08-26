import { NextResponse } from 'next/server';
import {
  BUSINESS_FEATURES,
  emptyBusinessFeatureFlags,
  isBusinessFeatureKey,
  setBusinessFeatureFlag,
} from '@/lib/businessFeatures';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { query } from '@/services/MySQLService';

export async function GET() {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  try {
    const businesses = await query<{ business_id: string; name: string; feature_key: string | null; enabled: number | null }>(
      `SELECT b.business_id, b.name, f.feature_key, f.enabled
       FROM businesses b
       LEFT JOIN business_feature_flags f ON f.business_id = b.business_id
       WHERE b.deleted_at IS NULL
       ORDER BY b.name, f.feature_key`,
    );
    const rows = new Map<string, { business_id: string; name: string; features: ReturnType<typeof emptyBusinessFeatureFlags> }>();
    for (const business of businesses) {
      const row = rows.get(business.business_id) ?? {
        business_id: business.business_id,
        name: business.name,
        features: emptyBusinessFeatureFlags(),
      };
      if (business.feature_key && isBusinessFeatureKey(business.feature_key)) {
        row.features[business.feature_key] = Boolean(business.enabled);
      }
      rows.set(business.business_id, row);
    }
    return NextResponse.json({ features: BUSINESS_FEATURES, businesses: [...rows.values()] });
  } catch (caught) {
    await reportRuntimeIssue({
      source: 'admin/features', operation: 'list', title: 'Business feature flags could not be loaded', error: caught,
      context: { actorUserId: auth.user.userId },
    });
    return NextResponse.json({ error: 'Feature controls could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const businessId = String(body.business_id ?? '').trim();
  const featureKey = String(body.feature_key ?? '').trim();
  if (!businessId || !isBusinessFeatureKey(featureKey) || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'A valid business, feature, and enabled value are required.' }, { status: 400 });
  }
  try {
    const businesses = await query<{ business_id: string }>(
      'SELECT business_id FROM businesses WHERE business_id = ? AND deleted_at IS NULL LIMIT 1',
      [businessId],
    );
    if (!businesses[0]) return NextResponse.json({ error: 'Business not found.' }, { status: 404 });
    await setBusinessFeatureFlag({
      businessId,
      featureKey,
      enabled: body.enabled,
      actorUserId: auth.user.userId,
      actorName: auth.user.name || auth.user.email,
    });
    return NextResponse.json({ success: true, business_id: businessId, feature_key: featureKey, enabled: body.enabled });
  } catch (caught) {
    await reportRuntimeIssue({
      businessId, source: 'admin/features', operation: 'update', title: 'Business feature flag could not be updated', error: caught,
      context: { featureKey, enabled: body.enabled, actorUserId: auth.user.userId },
    });
    return NextResponse.json({ error: 'Feature control could not be updated.' }, { status: 500 });
  }
}
