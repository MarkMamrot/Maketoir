import { consignmentRequest } from '@/lib/ims/consignment/http';
import { activity } from '@/lib/ims/consignment/statements';
import { exportConsignment } from '@/lib/ims/consignment/exports';
import { ACTIVITY_LABEL, ConsignmentError } from '@/lib/ims/consignment/domain';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  return consignmentRequest('activity', false, async (db, session) => {
    const params = new URL(req.url).searchParams;
    const format = params.get('format');
    if (format && !['csv', 'pdf'].includes(format)) throw new ConsignmentError('Export format must be csv or pdf.');
    const result = await activity(db, session.businessId, params);
    return format ? exportConsignment(result, format, ACTIVITY_LABEL, [`Period: ${params.get('from')} to ${params.get('to')}`, `Business: ${session.company ?? 'Business'}`]) : result;
  });
}
