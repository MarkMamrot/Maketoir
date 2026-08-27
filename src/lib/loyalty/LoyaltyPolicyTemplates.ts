import crypto from 'crypto';

export const LOYALTY_POLICY_TEMPLATE_VERSION = 'au-retail-v1';

export interface LoyaltyPolicyMerchantDetails {
  legalName: string;
  tradingName: string;
  businessNumber: string;
  contactEmail: string;
  contactAddress: string;
  jurisdiction: string;
}

export interface HostedLoyaltyPolicySnapshot {
  templateVersion: string;
  merchant: LoyaltyPolicyMerchantDetails;
  termsMarkdown: string;
  privacyMarkdown: string;
  contentHash: string;
}

function required(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function markdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, '\\$1');
}

export function normalizeLoyaltyPolicyMerchantDetails(input: Partial<LoyaltyPolicyMerchantDetails>): LoyaltyPolicyMerchantDetails {
  const contactEmail = required(input.contactEmail, 'Privacy contact email', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('Privacy contact email must be valid.');
  return {
    legalName: required(input.legalName, 'Legal entity name', 255),
    tradingName: required(input.tradingName, 'Trading name', 255),
    businessNumber: required(input.businessNumber, 'Business number', 100),
    contactEmail,
    contactAddress: required(input.contactAddress, 'Contact address', 1000),
    jurisdiction: required(input.jurisdiction, 'Governing jurisdiction', 100),
  };
}

export function buildHostedLoyaltyPolicies(input: Partial<LoyaltyPolicyMerchantDetails>): HostedLoyaltyPolicySnapshot {
  const merchant = normalizeLoyaltyPolicyMerchantDetails(input);
  const legalName = markdownText(merchant.legalName);
  const tradingName = markdownText(merchant.tradingName);
  const businessNumber = markdownText(merchant.businessNumber);
  const contactEmail = markdownText(merchant.contactEmail);
  const contactAddress = markdownText(merchant.contactAddress);
  const jurisdiction = markdownText(merchant.jurisdiction);

  const termsMarkdown = `# ${tradingName} loyalty program terms

These terms explain how customers join, earn and use points in the ${tradingName} loyalty program. The program is operated by ${legalName} (${businessNumber}).

## 1. Joining and eligibility

Membership is free and available to individual retail customers with an active customer account and valid email address. Membership is personal to you and cannot be sold, transferred or combined with another person's account.

You join when you accept the current terms in the customer rewards portal or authorise staff to enable membership. You are responsible for keeping your account details accurate and protecting access to your email account.

Joining the loyalty program does not by itself subscribe you to marketing. Marketing preferences are managed separately, and you may unsubscribe from promotional messages without leaving the loyalty program.

## 2. Earning points

The current earning rate is shown in the rewards portal and may change for future purchases. Points are calculated in whole points from eligible tax-inclusive merchandise value after discounts. Fractional points are rounded down.

- Points begin on eligible purchases completed after your effective enrolment date and are not backdated.
- Gift card purchases, delivery charges and the portion paid for by a loyalty reward do not earn points.
- Using a gift card as payment does not prevent eligible merchandise from earning points.
- Points are normally added after an eligible transaction is completed and linked to your customer account.

Identify your membership before an in-store sale is completed and use the email linked to your membership for online purchases.

## 3. Returns, cancellations and corrections

When an eligible purchase is returned, refunded, cancelled or corrected, related points may be reversed in proportion to the returned eligible value. A voided sale may also reverse any reward used on that sale. If affected points have already been used, contact ${tradingName} so the return and rewards account can be resolved correctly.

Nothing in these terms excludes, restricts or modifies rights or remedies that cannot lawfully be excluded, including rights under the Australian Consumer Law.

## 4. Using rewards in store

Available fixed-value rewards and their points cost are shown in the rewards portal or at the register. To use a reward in store, ask staff to link the correct customer account before payment. Required points are deducted when the reward is applied.

Points and rewards have no cash value, do not earn interest, cannot be exchanged for cash and cannot be used to purchase gift cards unless ${tradingName} expressly states otherwise.

## 5. Converting points for Shopify

You may convert an available reward into a Shopify discount through the rewards portal. When you confirm the conversion:

- the stated points are deducted immediately and the conversion is final;
- the code is restricted to your linked Shopify customer account and may be used once;
- the code cannot be combined with another discount; and
- the code expires 90 days after issue.

Expired or unused Shopify codes do not automatically restore points. An issued Shopify reward cannot also be used at a register.

## 6. Leaving the program

You may opt out through the rewards portal or by contacting ${tradingName}. Opting out stops future earning and redemption but does not delete records that must be retained. If you later rejoin, future earning resumes from the new enrolment date and earlier purchases are not backdated.

## 7. Errors, misuse and account security

${tradingName} may correct points or rewards credited or deducted in error and may suspend access while reasonably investigating fraud, misuse, duplicate accounts, unauthorised access or technical error. Points or rewards obtained through fraud or deliberate misuse may be cancelled.

## 8. Program changes

${tradingName} may change future earning rates, reward options or these terms, or suspend or close the program. Where practical, reasonable notice of a material adverse change and a reasonable opportunity to use existing points will be provided. Changes do not affect statutory rights.

## 9. Privacy

Personal information used for the loyalty program is handled under the current loyalty privacy policy and any broader website privacy policy published by ${tradingName}.

## 10. Liability and governing law

To the extent permitted by law, ${tradingName} is not responsible for indirect or consequential loss caused by unavailable points or rewards. Liability that cannot lawfully be excluded remains unaffected. These terms are governed by the laws of ${jurisdiction}.

## 11. Contact

Email ${contactEmail} or write to ${tradingName}, ${contactAddress}.
`;

  const privacyMarkdown = `# ${tradingName} loyalty privacy policy

This policy explains how ${tradingName} collects, uses, discloses and protects personal information for its loyalty program. The program is operated by ${legalName} (${businessNumber}).

## 1. Information we collect

When you use the loyalty program, we may collect and maintain:

- your name, email address, phone number and Shopify customer identifier;
- membership status, enrolment and opt-out dates, and the version of terms accepted;
- eligible purchase and return references used to calculate points;
- points balances, earning, adjustments, redemptions and activity dates;
- Shopify discount codes issued to you, their status and expiry; and
- authentication, session and security information used to send one-time codes, keep you signed in, prevent misuse and diagnose failures.

We do not collect payment card details through the rewards portal.

## 2. How we collect information

We collect information directly from you, from purchases and returns through participating stores, from the connected Shopify store, and from systems used to operate the loyalty program. When you request a sign-in code, the email provided is used to find a matching Shopify customer without confirming to other people whether that account exists.

## 3. Why we use it

We use loyalty information to verify identity, provide account access, record consent, manage membership, calculate and redeem points, create customer-only Shopify discounts, resolve returns and disputes, prevent misuse, maintain records and comply with legal obligations.

Joining the loyalty program does not by itself consent to marketing. Contact details are used for marketing only in line with preferences and permissions provided separately.

## 4. When we disclose information

We may disclose information needed to operate the program to service providers acting for us, including Shopify, Solvantis, email delivery providers, hosting, security and technical support providers. We may also disclose information where required or authorised by law, to protect customers or our rights, or as part of a business transaction subject to appropriate safeguards. We do not sell loyalty-program personal information.

## 5. Overseas processing

Some service providers may store or process information outside Australia. Their locations can change. We take reasonable steps to use providers with appropriate privacy and security protections, while overseas recipients may be subject to the laws of their country.

## 6. Storage, security and retention

We use reasonable technical and organisational measures intended to protect information from loss, misuse and unauthorised access. No internet service can guarantee absolute security.

Rewards account and transaction records are retained for as long as reasonably needed to operate the program, resolve disputes, prevent fraud and satisfy accounting, legal and regulatory obligations. Opting out does not automatically delete transaction history.

## 7. Access and correction

You may ask to access or correct personal information held about you and may ask for deletion where applicable. Some records may need to be retained for legal, security, recordkeeping or dispute-resolution purposes. Key membership, balance, redemption and activity information is available in the rewards portal.

## 8. Cookies and sign-in

The rewards portal uses a strictly necessary session cookie after successful email-code verification. It keeps you signed in and expires automatically. You can remove it by signing out or clearing browser data. Blocking necessary cookies may prevent the portal from working.

## 9. Complaints

Contact us first if you have a privacy concern. We will review and respond within a reasonable period. If you are not satisfied, you may be entitled to contact the Office of the Australian Information Commissioner at https://www.oaic.gov.au.

## 10. Changes to this policy

We may update this policy when the program, service providers or legal requirements change. The current version and effective date will be published with the policy. Material changes affecting membership consent may require acceptance of updated terms.

## 11. Contact

Email ${contactEmail} or write to Privacy Compliance Officer, ${tradingName}, ${contactAddress}.
`;

  const contentHash = crypto.createHash('sha256').update(JSON.stringify({
    templateVersion: LOYALTY_POLICY_TEMPLATE_VERSION,
    merchant,
    termsMarkdown,
    privacyMarkdown,
  })).digest('hex');

  return { templateVersion: LOYALTY_POLICY_TEMPLATE_VERSION, merchant, termsMarkdown, privacyMarkdown, contentHash };
}