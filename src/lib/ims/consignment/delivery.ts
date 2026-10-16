import { createHash } from 'crypto';
import { Resend } from 'resend';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { execute, query, transaction } from './db';
import { ACCOUNTING_GUIDANCE, ConsignmentError, requireId, requireText } from './domain';
import { exportConsignment } from './exports';
import { statementDetail } from './statements';
import { requireTracking } from './tracking';

interface Delivery { id: number; recipient: string; status: string; provider_reference: string | null }
export interface DeliveryResult { id: number; status: string; providerReference: string | null; providerAccepted: boolean; deliveryConfirmed: false }
export class DefinitiveDeliveryFailure extends Error {}
export async function sendSupplierStatement(input: { recipient: string; subject: string; text: string; pdf: Buffer; idempotencyKey: string }): Promise<string> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!, to: [input.recipient], subject: input.subject, text: input.text,
    attachments: [{ filename: 'consignment-statement.pdf', content: input.pdf }],
  }, { idempotencyKey: input.idempotencyKey });
  if (error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    if (status >= 400 && status < 500 && ![408, 409].includes(status)) throw new DefinitiveDeliveryFailure('Provider rejected the statement email.');
    throw new Error('Statement email provider outcome is uncertain.');
  }
  if (!data?.id) throw new Error('Statement email provider returned no acceptance reference.');
  return data.id;
}
function deliveryResult(delivery: Delivery): DeliveryResult {
  return { id: delivery.id, status: delivery.status, providerReference: delivery.provider_reference,
    providerAccepted: delivery.status === 'Sent', deliveryConfirmed: false };
}
async function deliveryAudit(db: Parameters<typeof execute>[0], businessId: string, statementId: number, actorId: number | null, action: string, details: unknown) {
  await execute(db, 'INSERT INTO ims_consignment_statement_audit (business_id,statement_id,actor_id,action,details_json) VALUES (?,?,?,?,?)',
    [businessId, statementId, actorId, action, JSON.stringify(details)]);
}
export async function deliverStatement(
  businessId: string, actorId: number | null, statementId: number, body: Record<string, unknown>,
  transport = sendSupplierStatement,
): Promise<DeliveryResult> {
  if (body.acknowledge !== true) throw new ConsignmentError('Explicitly confirm this supplier email or reviewed outcome.');
  if (body.action === 'resolve') {
    const deliveryId = requireId(body.deliveryId, 'Delivery');
    const reason = requireText(body.reason, 'Reviewed outcome reason');
    if (!['Sent', 'Failed'].includes(String(body.outcome))) throw new ConsignmentError('Reviewed outcome must be Sent or Failed.');
    return transaction(businessId, async db => {
      await requireTracking(db, businessId);
      const [delivery] = await query<Delivery & { age_seconds: number }>(db,
        'SELECT *,TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP()) age_seconds FROM ims_consignment_deliveries WHERE business_id=? AND statement_id=? AND id=? FOR UPDATE', [businessId, statementId, deliveryId]);
      if (!delivery) throw new ConsignmentError('Delivery not found.', 404);
      if (delivery.status !== 'Unconfirmed' && !(delivery.status === 'Sending' && delivery.age_seconds >= 300)) throw new ConsignmentError('Only uncertain or stale sending outcomes can be reviewed.', 409);
      const reference = body.outcome === 'Sent' ? requireText(body.providerReference, 'Provider acceptance reference', 255) : null;
      await execute(db, 'UPDATE ims_consignment_deliveries SET status=?,provider_reference=? WHERE business_id=? AND id=?', [body.outcome, reference, businessId, deliveryId]);
      await deliveryAudit(db, businessId, statementId, actorId, 'DeliveryReviewed', { deliveryId, outcome: body.outcome, reason, providerReference: reference });
      return deliveryResult({ ...delivery, status: String(body.outcome), provider_reference: reference });
    });
  }
  const recipient = requireText(body.recipient, 'Recipient', 254).toLowerCase();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(recipient)) throw new ConsignmentError('Enter one valid supplier email address.');
  const requestKey = requireText(body.requestKey, 'Email request key', 100);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey)) throw new ConsignmentError('Email request key must be a stable unique identifier.');
  const operationKey = createHash('sha256').update(`${statementId}:${requestKey}`).digest('hex');
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw new ConsignmentError('Supplier email delivery is not configured. Download the PDF/CSV instead.', 409);
  // Persist Sending before contacting a provider. A process crash never loses evidence of a possible send.
  const prepared = await transaction(businessId, async db => {
    await requireTracking(db, businessId);
    const detail = await statementDetail(db, businessId, statementId, true);
    if (!['Finalised', 'Accounted'].includes(detail.statement.status)) throw new ConsignmentError('Only finalised/accounted statements may be sent.', 409);
    const [existing] = await query<Delivery>(db, 'SELECT * FROM ims_consignment_deliveries WHERE business_id=? AND operation_key=? FOR UPDATE', [businessId, operationKey]);
    if (existing) {
      if (existing.recipient !== recipient) throw new ConsignmentError('This request key belongs to a different recipient.', 409);
      return { existing };
    }
    const unresolved = await query<Delivery>(db, "SELECT * FROM ims_consignment_deliveries WHERE business_id=? AND statement_id=? AND status IN ('Sending','Unconfirmed') FOR UPDATE", [businessId, statementId]);
    if (unresolved.length) throw new ConsignmentError('Review the unresolved delivery outcome before sending again.', 409);
    const sent = await query<Delivery>(db, "SELECT * FROM ims_consignment_deliveries WHERE business_id=? AND statement_id=? AND status='Sent'", [businessId, statementId]);
    if (sent.length && body.resend !== true) throw new ConsignmentError('This statement was already accepted by the provider. Explicitly confirm a resend.', 409);
    const resendReason = sent.length ? requireText(body.reason, 'Resend reason') : null;
    const saved = detail.statement.snapshot_json;
    const pdf = await exportConsignment(detail.projection, 'pdf', `Consignment Settlement Statement ${detail.statement.number} - ${detail.statement.status}`, [
      `Business: ${saved.business.name}`, `Supplier: ${saved.supplier.company || saved.supplier.name}`,
      `Period: ${detail.statement.period_from} to ${detail.statement.period_to}`,
    ]);
    const result = await execute(db, "INSERT INTO ims_consignment_deliveries (business_id,statement_id,operation_key,recipient,status,actor_id) VALUES (?,?,?,?,'Sending',?)", [businessId, statementId, operationKey, recipient, actorId]);
    await deliveryAudit(db, businessId, statementId, actorId, 'Sending', { deliveryId: result.insertId, explicitResend: sent.length > 0, resendReason });
    return {
      deliveryId: result.insertId, recipient, pdf: Buffer.from(await pdf.arrayBuffer()),
      subject: `${saved.business.name}: Consignment Settlement Statement ${detail.statement.number}`.replace(/[\r\n]/g, ' '),
      text: `Consignment Settlement Statement ${detail.statement.number}\nSupplier: ${saved.supplier.company || saved.supplier.name}\nPeriod: ${detail.statement.period_from} to ${detail.statement.period_to}\nAUD ${detail.projection.totals.total.toFixed(2)}\n${ACCOUNTING_GUIDANCE}\nThis email contains a statement, not confirmation of payment.`,
    };
  });
  if ('existing' in prepared && prepared.existing) return deliveryResult(prepared.existing);
  if (!('deliveryId' in prepared) || !prepared.deliveryId) throw new Error('Delivery preparation failed.');
  let status = 'Unconfirmed'; let providerReference: string | null = null; let failure: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    providerReference = await Promise.race([
      transport({ recipient: prepared.recipient!, subject: prepared.subject!, text: prepared.text!, pdf: prepared.pdf!,
        idempotencyKey: `consignment-${createHash('sha256').update(`${businessId}:${prepared.deliveryId}`).digest('hex')}` }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Statement email provider timed out; delivery is unconfirmed.')), 25_000); }),
    ]);
    if (!providerReference) throw new Error('Provider acceptance is unconfirmed.');
    status = 'Sent';
  } catch (error) { failure = error; status = error instanceof DefinitiveDeliveryFailure ? 'Failed' : 'Unconfirmed'; }
  finally { if (timer) clearTimeout(timer); }
  try {
    await transaction(businessId, async db => {
      const updated = await execute(db, "UPDATE ims_consignment_deliveries SET status=?,provider_reference=? WHERE business_id=? AND id=? AND status='Sending'", [status, providerReference, businessId, prepared.deliveryId]);
      if (updated.affectedRows !== 1) throw new Error('Delivery state changed before provider outcome was recorded.');
      await deliveryAudit(db, businessId, statementId, actorId, status, { deliveryId: prepared.deliveryId, providerReference, providerAccepted: status === 'Sent', deliveryConfirmed: false });
    });
  } catch (error) {
    await reportRuntimeIssue({ businessId, source: 'ims.consignment', operation: 'email-outcome-persistence', title: 'Consignment email outcome requires review', error, reference: { type: 'consignment-delivery', id: prepared.deliveryId }, context: { statementId, providerAccepted: status === 'Sent' } });
    throw new ConsignmentError('Email outcome could not be recorded. Do not resend; review the sending attempt.', 409);
  }
  if (failure) await reportRuntimeIssue({ businessId, source: 'ims.consignment', operation: 'supplier-statement-email', title: 'Consignment statement email failed or is unconfirmed', error: failure, reference: { type: 'consignment-delivery', id: prepared.deliveryId }, context: { statementId, status } });
  return { id: prepared.deliveryId, status, providerReference, providerAccepted: status === 'Sent', deliveryConfirmed: false };
}
