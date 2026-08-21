export interface WholesaleAddress {
  address: string | null;
  address2: string | null;
  suburb: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string;
}

export interface WholesaleAccountProfile {
  company: {
    id: number;
    name: string;
    taxId: string | null;
    paymentTerms: string | null;
    onAccountLimit: number | null;
  };
  location: {
    id: number;
    name: string;
    isPrimary: boolean;
    billingAddress: WholesaleAddress;
    shippingAddress: WholesaleAddress;
  };
  member: {
    id: number;
    role: 'owner' | 'admin' | 'buyer';
  };
  locations: Array<{
    id: number;
    name: string;
    isPrimary: boolean;
  }>;
}