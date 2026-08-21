export interface WholesaleCartIdentity {
  supplierSlug: string;
  businessId: string;
  contactId: number;
  companyId?: number;
  locationId?: number;
  memberId?: number;
}

export const LEGACY_WHOLESALE_CART_KEY = 'wholesale_cart';

export function getWholesaleCartStorageKey(identity: WholesaleCartIdentity): string | null {
  const supplierSlug = identity.supplierSlug.trim().toLowerCase();
  const businessId = identity.businessId.trim();
  if (!supplierSlug || !businessId || !identity.contactId || !identity.companyId || !identity.locationId || !identity.memberId) {
    return null;
  }
  return [
    'wholesale_cart:v2',
    supplierSlug,
    businessId,
    identity.contactId,
    identity.companyId,
    identity.locationId,
    identity.memberId,
  ].map(part => encodeURIComponent(String(part))).join(':');
}