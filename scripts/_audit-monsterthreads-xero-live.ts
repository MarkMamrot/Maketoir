import 'dotenv/config';
import { xeroApiFetch } from '../src/services/XeroService';

const businessId = '1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps';
const accountCodes = new Set(['41000', '11110', '61206', '11127', '61209', '11128', '61207', '61700', '21650', '21651']);

async function main() {
  const [accountResponse, trackingResponse] = await Promise.all([
    xeroApiFetch(businessId, '/Accounts'),
    xeroApiFetch(businessId, '/TrackingCategories'),
  ]);

  const accounts = (accountResponse?.Accounts ?? [])
    .filter((account: any) => accountCodes.has(String(account.Code ?? '')))
    .map((account: any) => ({ code: account.Code, name: account.Name, type: account.Type, class: account.Class, taxType: account.TaxType, status: account.Status }));
  const tracking = (trackingResponse?.TrackingCategories ?? []).map((category: any) => ({
    id: category.TrackingCategoryID,
    name: category.Name,
    options: (category.Options ?? []).map((option: any) => ({ id: option.TrackingOptionID, name: option.Name, status: option.Status })),
  }));
  console.log(JSON.stringify({ accounts, tracking }, null, 2));
}

void main();
