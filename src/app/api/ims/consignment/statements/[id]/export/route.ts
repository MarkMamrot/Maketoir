import { consignmentRequest } from '@/lib/ims/consignment/http';
import { statementDetail } from '@/lib/ims/consignment/statements';
import { exportConsignment } from '@/lib/ims/consignment/exports';
import { ConsignmentError, requireId } from '@/lib/ims/consignment/domain';

export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return consignmentRequest('statement-export', false, async (db, session) => {
    const format = new URL(req.url).searchParams.get('format');
    if (!format || !['csv', 'pdf'].includes(format)) throw new ConsignmentError('Export format must be csv or pdf.');
    const detail = await statementDetail(db, session.businessId, requireId(params.id));
    const saved = detail.statement.snapshot_json;
    return exportConsignment(detail.projection, format, `Consignment Settlement Statement ${detail.statement.number} - ${detail.statement.status}`, [
      `Business: ${saved.business.name}`, `Supplier: ${saved.supplier.company || saved.supplier.name}`,
      `Period: ${detail.statement.period_from} to ${detail.statement.period_to}`, 'Accounted means recorded by the bookkeeper, not paid.',
    ]);
  });
}
