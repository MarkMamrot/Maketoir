import { actorId, consignmentRequest, readBody } from '@/lib/ims/consignment/http';
import { mutateStatement, statementDetail } from '@/lib/ims/consignment/statements';
import { requireId } from '@/lib/ims/consignment/domain';

export const dynamic = 'force-dynamic';
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return consignmentRequest('statement-read', false, (db, session) => statementDetail(db, session.businessId, requireId(params.id)));
}
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return consignmentRequest('statement-update', true, async (db, session) => mutateStatement(db, session.businessId, actorId(session), requireId(params.id), await readBody(req)));
}
