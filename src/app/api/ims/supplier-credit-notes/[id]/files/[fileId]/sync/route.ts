import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { ImsSupplierCNRepo, ImsSupplierCNFilesRepo } from '@/lib/ims/ImsRepository';
import { syncSupplierCNAttachmentsToXero } from '@/services/XeroSyncService';

export async function POST(_: Request, { params }: { params: { id: string; fileId: string } }) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const scnId = Number(params.id);
  const fileId = Number(params.fileId);
  if (isNaN(scnId) || isNaN(fileId)) {
    return NextResponse.json({ error: 'Invalid supplier credit note file id' }, { status: 400 });
  }

  const scn = await ImsSupplierCNRepo.get(scnId, session.businessId).catch(() => null);
  if (!scn) return NextResponse.json({ error: 'Supplier credit note not found' }, { status: 404 });
  if (!scn.xero_credit_note_id) {
    return NextResponse.json({ error: 'Supplier credit note is not synced to Xero yet.' }, { status: 400 });
  }

  const file = await ImsSupplierCNFilesRepo.get(fileId, session.businessId).catch(() => null);
  if (!file || Number(file.scn_id) !== scnId) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  await syncSupplierCNAttachmentsToXero(
    session.businessId,
    scnId,
    scn.scn_number,
    scn.xero_credit_note_id,
    [file.filename],
  );

  return NextResponse.json({ success: true });
}
