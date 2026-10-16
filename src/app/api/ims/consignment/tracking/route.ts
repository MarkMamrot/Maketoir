import { actorId, consignmentRequest, readBody } from '@/lib/ims/consignment/http';
import { trackingOverview, transitionTracking } from '@/lib/ims/consignment/tracking';

export const dynamic = 'force-dynamic';
export async function GET() {
  return consignmentRequest('tracking-read', false, (db, session) => trackingOverview(db, session.businessId));
}
export async function PUT(req: Request) {
  return consignmentRequest('tracking-transition', true, async (db, session) => transitionTracking(db, session.businessId, actorId(session), await readBody(req)));
}
