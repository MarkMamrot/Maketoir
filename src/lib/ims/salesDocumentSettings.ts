export const SALES_DOCUMENT_SETTING_KEYS = {
  showLogo: 'sales_document_show_logo',
  note: 'sales_document_note',
  bankAccountName: 'sales_document_bank_account_name',
  bankBsb: 'sales_document_bank_bsb',
  bankAccountNumber: 'sales_document_bank_account_number',
  paymentInstructions: 'sales_document_payment_instructions',
} as const;

type ValidationResult = { value: string } | { error: string };

export function validateSalesDocumentSetting(key: string, rawValue: unknown): ValidationResult | null {
  const value = String(rawValue ?? '').trim();
  if (key === SALES_DOCUMENT_SETTING_KEYS.showLogo) {
    return ['0', '1'].includes(value)
      ? { value }
      : { error: 'Sales document logo visibility must be 0 or 1.' };
  }

  const textLimits: Record<string, [label: string, maxLength: number]> = {
    [SALES_DOCUMENT_SETTING_KEYS.note]: ['Invoice note', 1000],
    [SALES_DOCUMENT_SETTING_KEYS.bankAccountName]: ['Bank account name', 120],
    [SALES_DOCUMENT_SETTING_KEYS.paymentInstructions]: ['Payment instructions', 500],
  };
  const textLimit = textLimits[key];
  if (textLimit) {
    return value.length <= textLimit[1]
      ? { value }
      : { error: `${textLimit[0]} must be ${textLimit[1]} characters or fewer.` };
  }

  if (key === SALES_DOCUMENT_SETTING_KEYS.bankBsb) {
    return !value || (/^[0-9 -]{5,9}$/.test(value) && value.replace(/\D/g, '').length === 6)
      ? { value }
      : { error: 'BSB must contain exactly 6 digits.' };
  }
  if (key === SALES_DOCUMENT_SETTING_KEYS.bankAccountNumber) {
    const digits = value.replace(/\D/g, '');
    return !value || (/^[0-9 -]{4,24}$/.test(value) && digits.length >= 4 && digits.length <= 16)
      ? { value }
      : { error: 'Bank account number must contain 4 to 16 digits.' };
  }

  return null;
}