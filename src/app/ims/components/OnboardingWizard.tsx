'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, HelpCircle, X } from 'lucide-react';

export type OnboardingStep = {
  id: string;
  title: string;
  completed: boolean;
  autoCompleted: boolean;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  complete: boolean;
  counts?: Record<string, number>;
};

type Props = {
  open: boolean;
  onboarding: OnboardingState;
  draft: Record<string, string>;
  saving: boolean;
  xeroAccountingEnabled: boolean;
  onClose: () => void;
  onFieldChange: (key: string, value: string) => void;
  onSaveStep: (stepId: string, settings: Record<string, string>) => Promise<void>;
  onCompleteStep: (stepId: string) => Promise<void>;
  onAction: (stepId: string) => void;
};

const CONFIG_STEP_FIELDS: Record<string, string[]> = {
  business_profile: [
    'business_name', 'business_abn', 'business_phone', 'business_address_line1',
    'business_address_line2', 'business_suburb', 'business_state', 'business_postcode',
    'business_country',
  ],
  operations: ['use_multiple_locations', 'use_zones_bins', 'use_categories', 'use_foreign_currencies', 'business_requires_pos'],
  tax: ['sales_tax_on_sales', 'sales_tax_rate', 'sales_tax_code', 'purchase_tax_rate', 'purchase_tax_code'],
  integrations: ['shopify_enabled', 'native_shop_enabled', 'connect_accounting_software', 'accounting_software'],
};

const ACTION_COPY: Record<string, { heading: string; body: string; action: string }> = {
  users: {
    heading: 'Bring your team in',
    body: 'Add the people who will use Solvantis and assign the access level each person needs.',
    action: 'Open user management',
  },
  locations: {
    heading: 'Set up your locations',
    body: 'Create each shop, warehouse, or fulfilment location that holds stock or processes sales.',
    action: 'Open locations',
  },
  brands: {
    heading: 'Add your brands',
    body: 'Create the brands used to organise products, control wholesale access, and support product research.',
    action: 'Open brands',
  },
  suppliers: {
    heading: 'Add your suppliers',
    body: 'Create supplier contacts before products so catalogue items and purchase orders can link to the right supplier.',
    action: 'Open suppliers',
  },
  products: {
    heading: 'Build your product catalogue',
    body: 'Import products from your inventory source or add the catalogue you will manage in Solvantis.',
    action: 'Open products',
  },
  sales_orders: {
    heading: 'Bring in sales orders',
    body: 'Import current sales orders so customer demand and committed stock begin from the right position.',
    action: 'Open sales orders',
  },
  purchase_orders: {
    heading: 'Bring in purchase orders',
    body: 'Import open supplier orders so incoming stock and expected delivery dates are visible.',
    action: 'Open purchase orders',
  },
  opening_stock: {
    heading: 'Confirm opening stock',
    body: 'Load or adjust opening stock only after products and locations are ready. This establishes the starting inventory position.',
    action: 'Open stock setup',
  },
  pos_ready: {
    heading: 'Review Point of Sale',
    body: 'Check payment methods, registers, receipt details, and product visibility before the first live sale.',
    action: 'Open POS settings',
  },
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 11px',
  borderRadius: 6,
  border: '1px solid var(--sv-etch)',
  background: 'var(--sv-bg-1)',
  color: 'var(--sv-text-main)',
  fontSize: 13,
};

function Field({ label, help, children, wide = false }: { label: string; help: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label style={{ display: 'block', minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, color: 'var(--sv-text-dim)', fontSize: 11, fontWeight: 700 }}>
        {label}
        <span title={help} aria-label={help} style={{ display: 'inline-flex', cursor: 'help' }}>
          <HelpCircle size={13} />
        </span>
      </span>
      {children}
    </label>
  );
}

function YesNo({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', width: 170, border: '1px solid var(--sv-etch)', borderRadius: 6, overflow: 'hidden' }}>
      {(['yes', 'no'] as const).map(option => {
        const selected = value === option;
        return (
          <button key={option} type="button" onClick={() => onChange(option)} style={{
            padding: '9px 16px', border: 0, borderLeft: option === 'no' ? '1px solid var(--sv-etch)' : 0,
            background: selected ? 'var(--sv-action)' : 'var(--sv-bg-1)',
            color: selected ? '#fff' : 'var(--sv-text-dim)', fontSize: 13, fontWeight: selected ? 700 : 500,
            cursor: 'pointer',
          }}>
            {option === 'yes' ? 'Yes' : 'No'}
          </button>
        );
      })}
    </div>
  );
}

export function OnboardingWizard({ open, onboarding, draft, saving, xeroAccountingEnabled, onClose, onFieldChange, onSaveStep, onCompleteStep, onAction }: Props) {
  const firstIncomplete = Math.max(0, onboarding.steps.findIndex(step => !step.completed));
  const [activeIndex, setActiveIndex] = useState(firstIncomplete);

  useEffect(() => {
    if (open) setActiveIndex(firstIncomplete);
  }, [open, firstIncomplete]);

  if (!open) return null;
  const step = onboarding.steps[activeIndex] ?? onboarding.steps[0];
  if (!step) return null;
  const isConfigStep = Boolean(CONFIG_STEP_FIELDS[step.id]);
  const completedCount = onboarding.steps.filter(item => item.completed).length;

  const saveAndContinue = async () => {
    const fields = CONFIG_STEP_FIELDS[step.id] ?? [];
    await onSaveStep(step.id, Object.fromEntries(fields.map(key => [key, draft[key] ?? ''])));
    setActiveIndex(index => Math.min(onboarding.steps.length - 1, index + 1));
  };

  const markDone = async () => {
    await onCompleteStep(step.id);
    if (activeIndex < onboarding.steps.length - 1) setActiveIndex(activeIndex + 1);
  };

  const renderConfigStep = () => {
    if (step.id === 'business_profile') {
      return (
        <>
          <header><div className="ob-eyebrow">Step 1</div><h2>Business identity</h2><p>Start with the details customers and suppliers will see on your documents.</p></header>
          <div className="ob-fields">
            <Field label="Business name" help="The trading or legal name shown on purchase orders, invoices, and receipts.">
              <input style={inputStyle} value={draft.business_name ?? ''} onChange={event => onFieldChange('business_name', event.target.value)} placeholder="Your business name" />
            </Field>
            <Field label="ABN" help="Your Australian Business Number. This is printed on tax invoices.">
              <input style={inputStyle} value={draft.business_abn ?? ''} onChange={event => onFieldChange('business_abn', event.target.value)} placeholder="11 222 333 444" />
            </Field>
            <Field label="Phone number" help="The main business contact number shown on customer-facing documents.">
              <input type="tel" autoComplete="tel" style={inputStyle} value={draft.business_phone ?? ''} onChange={event => onFieldChange('business_phone', event.target.value)} placeholder="(02) 1234 5678" />
            </Field>
            <Field label="Country" help="The country used when formatting your business address.">
              <input autoComplete="country-name" style={inputStyle} value={draft.business_country ?? ''} onChange={event => onFieldChange('business_country', event.target.value)} placeholder="Australia" />
            </Field>
            <Field wide label="Address line 1" help="Street number and street name for the business address.">
              <input autoComplete="address-line1" style={inputStyle} value={draft.business_address_line1 ?? draft.business_address ?? ''} onChange={event => onFieldChange('business_address_line1', event.target.value)} placeholder="123 Main Street" />
            </Field>
            <Field wide label="Address line 2" help="Optional unit, suite, level, or building information.">
              <input autoComplete="address-line2" style={inputStyle} value={draft.business_address_line2 ?? ''} onChange={event => onFieldChange('business_address_line2', event.target.value)} placeholder="Suite 4" />
            </Field>
            <Field label="Suburb" help="The suburb or locality for the business address.">
              <input autoComplete="address-level2" style={inputStyle} value={draft.business_suburb ?? ''} onChange={event => onFieldChange('business_suburb', event.target.value)} placeholder="Sydney" />
            </Field>
            <Field label="State" help="The state or territory, such as NSW, VIC, or QLD.">
              <input autoComplete="address-level1" style={inputStyle} value={draft.business_state ?? ''} onChange={event => onFieldChange('business_state', event.target.value)} placeholder="NSW" />
            </Field>
            <Field label="Postcode" help="The postal code for the business address.">
              <input autoComplete="postal-code" inputMode="numeric" style={inputStyle} value={draft.business_postcode ?? ''} onChange={event => onFieldChange('business_postcode', event.target.value)} placeholder="2000" />
            </Field>
          </div>
        </>
      );
    }

    if (step.id === 'operations') {
      return (
        <>
          <header><div className="ob-eyebrow">Step 2</div><h2>Operations</h2><p>Choose the inventory features that match how your business actually works.</p></header>
          <div className="ob-question-list">
            <Field label="Does your business require Point of Sale?" help="Enable this when selling directly to the public in stores or other staffed locations. It enables POS setup and Location Daybooks.">
              <YesNo value={draft.business_requires_pos ?? 'yes'} onChange={value => onFieldChange('business_requires_pos', value)} />
            </Field>
            <Field label="Does your business operate multiple locations?" help="Enable this for multiple shops, warehouses, or fulfilment locations. It turns on per-location stock and branch transfers.">
              <YesNo value={draft.use_multiple_locations ?? 'yes'} onChange={value => onFieldChange('use_multiple_locations', value)} />
            </Field>
            <Field label="Do you organise stock in zones and bins?" help="Zones and bins record the physical shelf or storage position of products inside a location.">
              <YesNo value={draft.use_zones_bins ?? 'no'} onChange={value => onFieldChange('use_zones_bins', value)} />
            </Field>
            <Field label="Do you organise products into categories?" help="Enable category and subcategory browsing and reporting for the product catalogue.">
              <YesNo value={draft.use_categories ?? 'no'} onChange={value => onFieldChange('use_categories', value)} />
            </Field>
            <Field label="Do you buy in foreign currencies?" help="Shows currency and exchange-rate fields on purchase orders and foreign-currency costs on products.">
              <YesNo value={draft.use_foreign_currencies ?? 'yes'} onChange={value => onFieldChange('use_foreign_currencies', value)} />
            </Field>
          </div>
        </>
      );
    }

    if (step.id === 'tax') {
      const rate = (key: string) => draft[key] ? String(Number(draft[key]) * 100) : '';
      return (
        <>
          <header><div className="ob-eyebrow">Step 3</div><h2>Tax settings</h2><p>Confirm how GST is applied to sales and purchases. Prices remain tax-inclusive throughout Solvantis.</p></header>
          <div className="ob-fields">
            <Field wide label="Charge sales tax on sales orders?" help="Choose Yes when sales orders and invoices should extract GST from their tax-inclusive totals.">
              <YesNo value={draft.sales_tax_on_sales ?? 'yes'} onChange={value => onFieldChange('sales_tax_on_sales', value)} />
            </Field>
            <Field label="Sales tax rate (%)" help="The GST percentage extracted from sales. The standard Australian GST rate is 10%.">
              <input type="number" min="0" max="100" step="0.01" style={inputStyle} value={rate('sales_tax_rate')} onChange={event => onFieldChange('sales_tax_rate', event.target.value ? String(Number(event.target.value) / 100) : '')} placeholder="10" />
            </Field>
            <Field label="Sales tax code" help="The label used for sales tax on documents and accounting mappings, usually GST.">
              <input style={inputStyle} value={draft.sales_tax_code ?? ''} onChange={event => onFieldChange('sales_tax_code', event.target.value)} placeholder="GST" />
            </Field>
            <Field label="Purchase tax rate (%)" help="The GST percentage applied to supplier purchases, normally 10% in Australia.">
              <input type="number" min="0" max="100" step="0.01" style={inputStyle} value={rate('purchase_tax_rate')} onChange={event => onFieldChange('purchase_tax_rate', event.target.value ? String(Number(event.target.value) / 100) : '')} placeholder="10" />
            </Field>
            <Field label="Purchase tax code" help="The accounting label for GST on supplier purchases, such as GST on Purchases.">
              <input style={inputStyle} value={draft.purchase_tax_code ?? ''} onChange={event => onFieldChange('purchase_tax_code', event.target.value)} placeholder="GST on Purchases" />
            </Field>
          </div>
        </>
      );
    }

    return (
      <>
        <header><div className="ob-eyebrow">Step 4</div><h2>Integrations</h2><p>Tell Solvantis which systems you plan to connect. You can complete the actual connection now or return later.</p></header>
        <div className="ob-question-list">
          <Field label="Use Shopify?" help="Enable Shopify product, order, inventory, and customer integration tools.">
            <YesNo value={draft.shopify_enabled ?? 'no'} onChange={value => onFieldChange('shopify_enabled', value)} />
          </Field>
          <Field label="Use Solvantis Online Store?" help="Enable native store setup. The public storefront remains unavailable until separately activated.">
            <YesNo value={draft.native_shop_enabled ?? 'no'} onChange={value => onFieldChange('native_shop_enabled', value)} />
          </Field>
          {xeroAccountingEnabled && <Field label="Connect accounting software?" help="Choose Yes to configure accounting document and payment synchronisation with Xero.">
            <YesNo value={draft.connect_accounting_software ?? 'no'} onChange={value => onFieldChange('connect_accounting_software', value)} />
          </Field>}
          {xeroAccountingEnabled && draft.connect_accounting_software === 'yes' && (
            <Field label="Accounting platform" help="Xero is currently supported for accounting integration.">
              <select style={{ ...inputStyle, maxWidth: 280 }} value={draft.accounting_software ?? 'xero'} onChange={event => onFieldChange('accounting_software', event.target.value)}><option value="xero">Xero</option></select>
            </Field>
          )}
        </div>
      </>
    );
  };

  const action = ACTION_COPY[step.id];
  return (
    <div className="ob-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <style>{`
        .ob-overlay { position: fixed; inset: 0; z-index: 10000; padding: 28px; background: rgba(10,18,28,.64); display: flex; align-items: center; justify-content: center; }
        .ob-shell { width: min(1080px, 100%); height: min(760px, calc(100vh - 56px)); display: grid; grid-template-columns: 260px minmax(0,1fr); overflow: hidden; background: var(--sv-bg-1); border: 1px solid var(--sv-etch); border-radius: 8px; box-shadow: 0 24px 80px rgba(0,0,0,.32); }
        .ob-side { padding: 26px 18px; overflow-y: auto; background: var(--sv-bg-2); border-right: 1px solid var(--sv-etch); }
        .ob-progress { height: 5px; margin: 12px 4px 18px; overflow: hidden; background: var(--sv-bg-1); border: 1px solid var(--sv-etch); border-radius: 99px; }
        .ob-progress > div { height: 100%; background: var(--sv-action); transition: width .2s ease; }
        .ob-step { width: 100%; min-height: 43px; padding: 5px 7px; display: grid; grid-template-columns: 27px minmax(0,1fr); align-items: center; gap: 9px; border: 0; border-radius: 6px; background: transparent; color: var(--sv-text-dim); text-align: left; cursor: pointer; }
        .ob-step[data-active='true'] { background: var(--sv-bg-1); color: var(--sv-text-strong); }
        .ob-step-number { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--sv-etch); font-size: 11px; font-weight: 800; }
        .ob-step[data-complete='true'] .ob-step-number { border-color: var(--sv-mint); background: var(--sv-mint); color: #fff; }
        .ob-main { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0,1fr) auto; }
        .ob-top { min-height: 56px; padding: 0 20px; display: flex; align-items: center; justify-content: flex-end; border-bottom: 1px solid var(--sv-etch); }
        .ob-content { padding: 34px clamp(28px,5vw,64px); overflow-y: auto; }
        .ob-content header { margin-bottom: 28px; }
        .ob-content h2 { margin: 3px 0 7px; color: var(--sv-text-strong); font-size: 27px; letter-spacing: 0; }
        .ob-content header p { max-width: 620px; margin: 0; color: var(--sv-text-dim); font-size: 14px; line-height: 1.6; }
        .ob-eyebrow { color: var(--sv-action); font-size: 10px; font-weight: 800; text-transform: uppercase; }
        .ob-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .ob-question-list { display: grid; gap: 21px; }
        .ob-action { min-height: 390px; display: grid; place-items: center; text-align: center; }
        .ob-action-inner { width: min(520px,100%); }
        .ob-action-icon { width: 58px; height: 58px; margin: 0 auto 18px; display: grid; place-items: center; border-radius: 50%; background: rgba(37,99,235,.12); color: var(--sv-action); font-size: 20px; font-weight: 800; }
        .ob-action h2 { margin: 0 0 10px; }
        .ob-action p { margin: 0 auto 24px; color: var(--sv-text-dim); font-size: 14px; line-height: 1.65; }
        .ob-footer { min-height: 70px; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--sv-etch); }
        .ob-button { min-height: 38px; padding: 8px 16px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--sv-etch); border-radius: 6px; background: var(--sv-bg-1); color: var(--sv-text-main); font-size: 13px; font-weight: 700; cursor: pointer; }
        .ob-button.primary { border-color: var(--sv-action); background: var(--sv-action); color: #fff; }
        .ob-button:disabled { opacity: .55; cursor: wait; }
        @media (max-width: 760px) { .ob-overlay { padding: 0; } .ob-shell { height: 100vh; border: 0; border-radius: 0; grid-template-columns: 1fr; grid-template-rows: auto minmax(0,1fr); } .ob-side { padding: 12px 14px; border-right: 0; border-bottom: 1px solid var(--sv-etch); overflow-x: auto; } .ob-side-title, .ob-progress-label { display:none; } .ob-progress { margin: 0 0 9px; } .ob-step-list { display: flex; gap: 4px; } .ob-step { width: auto; min-width: 34px; min-height: 34px; padding: 4px; grid-template-columns: 27px; } .ob-step-label { display: none; } .ob-content { padding: 24px 18px; } .ob-fields { grid-template-columns: 1fr; } .ob-content h2 { font-size: 23px; } }
      `}</style>
      <div className="ob-shell">
        <aside className="ob-side">
          <div className="ob-side-title" style={{ color: 'var(--sv-text-strong)', fontSize: 15, fontWeight: 800 }}>Business setup</div>
          <div className="ob-progress-label" style={{ marginTop: 4, color: 'var(--sv-text-dim)', fontSize: 11 }}>{completedCount} of {onboarding.steps.length} complete</div>
          <div className="ob-progress"><div style={{ width: `${(completedCount / onboarding.steps.length) * 100}%` }} /></div>
          <div className="ob-step-list">
            {onboarding.steps.map((item, index) => (
              <button key={item.id} type="button" className="ob-step" data-active={index === activeIndex} data-complete={item.completed} onClick={() => setActiveIndex(index)}>
                <span className="ob-step-number">{item.completed ? <Check size={14} /> : index + 1}</span>
                <span className="ob-step-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, fontWeight: index === activeIndex ? 750 : 550 }}>{item.title}</span>
              </button>
            ))}
          </div>
        </aside>
        <section className="ob-main">
          <div className="ob-top">
            <button type="button" onClick={onClose} title="Close onboarding" aria-label="Close onboarding" style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--sv-text-dim)', cursor: 'pointer' }}><X size={19} /></button>
          </div>
          <div className="ob-content" id="onboarding-title">
            {isConfigStep ? renderConfigStep() : action && (
              <div className="ob-action">
                <div className="ob-action-inner">
                  <div className="ob-action-icon">{activeIndex + 1}</div>
                  <h2>{action.heading}</h2>
                  <p>{action.body}</p>
                  <button type="button" className="ob-button primary" onClick={() => onAction(step.id)}>{action.action}<ArrowRight size={15} /></button>
                </div>
              </div>
            )}
          </div>
          <footer className="ob-footer">
            <button type="button" className="ob-button" disabled={activeIndex === 0 || saving} onClick={() => setActiveIndex(index => Math.max(0, index - 1))}><ArrowLeft size={15} />Back</button>
            {isConfigStep ? (
              <button type="button" className="ob-button primary" disabled={saving} onClick={saveAndContinue}>{saving ? 'Saving...' : activeIndex === onboarding.steps.length - 1 ? 'Finish' : 'Save and next'}<ArrowRight size={15} /></button>
            ) : (
              <button type="button" className="ob-button primary" disabled={saving} onClick={markDone}>{saving ? 'Saving...' : 'Mark done and continue'}<Check size={15} /></button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
