import { actorId, consignmentRequest, readBody } from '@/lib/ims/consignment/http';
import { createStatement, listStatements } from '@/lib/ims/consignment/statements';

export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  return consignmentRequest('statements-list', false, (db, session) => listStatements(db, session.businessId, new URL(req.url).searchParams.get('supplierId')));
}
export async function POST(req: Request) {
  return consignmentRequest('statement-create', true, async (db, session) => createStatement(db, session.businessId, actorId(session), session.company ?? 'Business', await readBody(req)));
}
