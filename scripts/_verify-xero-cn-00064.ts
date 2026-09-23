import 'dotenv/config';
import { xeroApiFetch } from '../src/services/XeroService';

async function main() {
  const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
  const response = await xeroApiFetch(businessId, '/CreditNotes/d963dca3-cce1-43f9-a4b7-2de54ea755b7');
  const credit = response?.CreditNotes?.[0];
  console.log(JSON.stringify(credit ? {
    creditNoteNumber: credit.CreditNoteNumber,
    status: credit.Status,
    total: credit.Total,
    remainingCredit: credit.RemainingCredit,
    allocations: credit.Allocations?.length ?? 0,
    updatedDateUtc: credit.UpdatedDateUTC,
  } : null, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
