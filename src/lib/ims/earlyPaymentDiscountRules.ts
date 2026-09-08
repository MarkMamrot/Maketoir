import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { buildEarlyPaymentDiscountSnapshot } from './earlyPaymentDiscount';

export type EarlyPaymentDiscountRuleRow = {
  id: number;
  business_id: string;
  name: string;
  discount_basis_points: number;
  discount_days: number;
  discount_base: 'merchandise';
  date_basis: 'invoice_date_order_fallback';
  is_active: number;
  contact_usage_count: number;
  order_usage_count: number;
  created_at: string;
  updated_at: string;
};

export type EarlyPaymentDiscountRuleWrite = {
  name: string;
  discountPercent: number;
  discountDays: number;
  isActive?: boolean;
};

export function normalizeEarlyPaymentDiscountRule(input: EarlyPaymentDiscountRuleWrite) {
  const name = String(input.name ?? '').trim();
  const discountPercent = Number(input.discountPercent);
  const discountDays = Number(input.discountDays);
  if (!name || name.length > 120) throw new Error('Rule name must be between 1 and 120 characters.');
  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
    throw new Error('Discount percentage must be greater than 0 and no more than 100.');
  }
  if (!Number.isInteger(discountDays) || discountDays < 0 || discountDays > 3650) {
    throw new Error('Discount days must be a whole number between 0 and 3650.');
  }
  return {
    name,
    discountBasisPoints: Math.round(discountPercent * 100),
    discountDays,
    isActive: input.isActive === undefined || Boolean(input.isActive),
  };
}

export const EarlyPaymentDiscountRulesRepository = {
  async list(businessId: string): Promise<EarlyPaymentDiscountRuleRow[]> {
    return imsQuery<EarlyPaymentDiscountRuleRow>(
      `SELECT r.*,
              ((SELECT COUNT(*) FROM ims_contacts c
                 WHERE c.business_id = r.business_id
                   AND (c.customer_early_payment_discount_rule_id = r.id
                     OR c.supplier_early_payment_discount_rule_id = r.id))) AS contact_usage_count,
              ((SELECT COUNT(*) FROM ims_purchase_orders po
                 WHERE po.business_id = r.business_id AND po.early_payment_discount_rule_id = r.id)
               + (SELECT COUNT(*) FROM ims_sales_orders so
                 WHERE so.business_id = r.business_id AND so.early_payment_discount_rule_id = r.id)) AS order_usage_count
         FROM ims_early_payment_discount_rules r
        WHERE r.business_id = ?
        ORDER BY r.is_active DESC, r.name ASC, r.id ASC`,
      [businessId],
    );
  },

  async get(id: number, businessId: string): Promise<EarlyPaymentDiscountRuleRow | null> {
    const rows = await imsQuery<EarlyPaymentDiscountRuleRow>(
      `SELECT r.*, 0 AS contact_usage_count, 0 AS order_usage_count
         FROM ims_early_payment_discount_rules r
        WHERE r.id = ? AND r.business_id = ?`,
      [id, businessId],
    );
    return rows[0] ?? null;
  },

  async requireActive(id: number, businessId: string): Promise<EarlyPaymentDiscountRuleRow> {
    const rule = await this.get(id, businessId);
    if (!rule || !Number(rule.is_active)) throw new Error('Selected early-payment discount rule is not active.');
    return rule;
  },

  async create(input: EarlyPaymentDiscountRuleWrite, businessId: string, actorId?: number | null): Promise<number> {
    const rule = normalizeEarlyPaymentDiscountRule(input);
    const result = await imsExecute(
      `INSERT INTO ims_early_payment_discount_rules
         (business_id, name, discount_basis_points, discount_days, discount_base, date_basis, is_active, created_by)
       VALUES (?, ?, ?, ?, 'merchandise', 'invoice_date_order_fallback', ?, ?)`,
      [businessId, rule.name, rule.discountBasisPoints, rule.discountDays, rule.isActive ? 1 : 0, actorId ?? null],
    );
    return Number(result.insertId);
  },

  async update(id: number, input: EarlyPaymentDiscountRuleWrite, businessId: string): Promise<boolean> {
    const rule = normalizeEarlyPaymentDiscountRule(input);
    const result = await imsExecute(
      `UPDATE ims_early_payment_discount_rules
          SET name = ?, discount_basis_points = ?, discount_days = ?, is_active = ?
        WHERE id = ? AND business_id = ?`,
      [rule.name, rule.discountBasisPoints, rule.discountDays, rule.isActive ? 1 : 0, id, businessId],
    );
    return Number(result.affectedRows ?? 0) > 0;
  },

  async deactivate(id: number, businessId: string): Promise<boolean> {
    const result = await imsExecute(
      `UPDATE ims_early_payment_discount_rules SET is_active = 0 WHERE id = ? AND business_id = ?`,
      [id, businessId],
    );
    return Number(result.affectedRows ?? 0) > 0;
  },
};

export type EarlyPaymentDiscountSelection = {
  mode?: 'contact_default' | 'override' | 'none';
  ruleId?: number | null;
};

export type EarlyPaymentDiscountOrderSnapshotFields = {
  early_payment_discount_rule_id: number | null;
  early_payment_discount_name: string | null;
  early_payment_discount_basis_points: number | null;
  early_payment_discount_days: number | null;
  early_payment_discount_base: string | null;
  early_payment_discount_date_basis: string | null;
  early_payment_discount_cutoff_date: string | null;
  early_payment_discount_source: string | null;
};

const EMPTY_SNAPSHOT: EarlyPaymentDiscountOrderSnapshotFields = {
  early_payment_discount_rule_id: null,
  early_payment_discount_name: null,
  early_payment_discount_basis_points: null,
  early_payment_discount_days: null,
  early_payment_discount_base: null,
  early_payment_discount_date_basis: null,
  early_payment_discount_cutoff_date: null,
  early_payment_discount_source: null,
};

export async function resolveEarlyPaymentDiscountOrderSnapshot(input: {
  businessId: string;
  documentType: 'purchase_order' | 'sales_order';
  contactId?: number | null;
  orderDate: string;
  supplierInvoiceDate?: string | null;
  selection?: EarlyPaymentDiscountSelection;
}): Promise<EarlyPaymentDiscountOrderSnapshotFields> {
  const mode = input.selection?.mode ?? 'contact_default';
  if (mode === 'none') return { ...EMPTY_SNAPSHOT };

  let ruleId = Number(input.selection?.ruleId ?? 0);
  if (mode === 'contact_default') {
    if (!input.contactId) return { ...EMPTY_SNAPSHOT };
    const field = input.documentType === 'purchase_order'
      ? 'supplier_early_payment_discount_rule_id'
      : 'customer_early_payment_discount_rule_id';
    const contacts = await imsQuery<Record<string, number | null>>(
      `SELECT ${field} AS rule_id FROM ims_contacts WHERE id = ? AND business_id = ?`,
      [input.contactId, input.businessId],
    );
    ruleId = Number(contacts[0]?.rule_id ?? 0);
    if (!ruleId) return { ...EMPTY_SNAPSHOT };
  }
  if (!Number.isInteger(ruleId) || ruleId <= 0) throw new Error('Select an active early-payment discount rule.');

  const rule = await EarlyPaymentDiscountRulesRepository.requireActive(ruleId, input.businessId);
  const snapshot = buildEarlyPaymentDiscountSnapshot({
    rule: {
      id: rule.id,
      name: rule.name,
      discountBasisPoints: Number(rule.discount_basis_points),
      discountDays: Number(rule.discount_days),
      discountBase: rule.discount_base,
      dateBasis: rule.date_basis,
    },
    documentType: input.documentType,
    orderDate: input.orderDate,
    supplierInvoiceDate: input.supplierInvoiceDate,
    source: mode === 'override' ? 'order_override' : 'contact_default',
  });
  return {
    early_payment_discount_rule_id: snapshot.ruleId,
    early_payment_discount_name: snapshot.name,
    early_payment_discount_basis_points: snapshot.discountBasisPoints,
    early_payment_discount_days: snapshot.discountDays,
    early_payment_discount_base: snapshot.discountBase,
    early_payment_discount_date_basis: snapshot.dateBasis,
    early_payment_discount_cutoff_date: snapshot.cutoffDate,
    early_payment_discount_source: snapshot.source,
  };
}