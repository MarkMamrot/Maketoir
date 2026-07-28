import { NextResponse } from 'next/server';
import { query } from '@/services/MySQLService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { requireAdminSession } from '@/lib/sessionUtils';
import { runScheduledCustomerService } from '@/lib/customer-service/scheduledProcessor';

export async function POST(req: Request) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret) {
    if (cronSecret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const businesses = await query<{ business_id: string; name: string }>(
      'SELECT business_id, name FROM businesses WHERE deleted_at IS NULL ORDER BY name',
    );
    const results = [];
    for (const business of businesses) {
      try {
        const result = await runImsForBusiness(business.business_id, () => runScheduledCustomerService(business.business_id));
        results.push({ businessId: business.business_id, name: business.name, result });
      } catch (error: any) {
        results.push({ businessId: business.business_id, name: business.name, error: error.message });
      }
    }
    return NextResponse.json({ success: true, businesses: results });
  }

  const { user, response } = requireAdminSession();
  if (response) return response;
  try {
    const result = await runScheduledCustomerService(user.businessId, true);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}