'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeftRight, Bookmark, BrainCircuit, ChevronDown, ClipboardCopy, Columns3, ExternalLink, FileDown, Link2, Link2Off, Mail, PackageCheck, RefreshCw, Save, Search, Trash2, Truck, WalletCards, Wrench } from 'lucide-react';
import ProductImageGallery from './components/ProductImageGallery';
import AiModelSettingsSection from './components/AiModelSettingsSection';
import AccountAiCreditsSection from './components/AccountAiCreditsSection';
import { OnboardingWizard, type OnboardingStep } from './components/OnboardingWizard';
import { DashboardSalesComparison } from './components/DashboardSalesComparison';
import { DashboardProductInsights } from './components/DashboardProductInsights';
import type { DashboardProductInsight } from '@/lib/ims/dashboardProductInsights';
import { buildStockTimeline } from '@/lib/ims/stockHistoryTimeline';
import { EarlyPaymentDiscountSettingsSection } from './views/settings/EarlyPaymentDiscountSettingsSection';
import { InventoryCostingSettings } from './views/settings/InventoryCostingSettings';
import { buildBarcodeLabelHtml, buildBarcodeSvgMarkup } from '@/lib/ims/barcodeLabelPrinter';
import { isCrmCustomerType } from '@/lib/ims/contactCrmAccess';
import { resolveImportMatch } from '@/lib/ims/importMatch';
import { deriveVariantSku } from '@/lib/ims/importSku';
import { optionCombinations } from '@/lib/ims/bulkProductEditor';
import { generateProductSku } from '@/lib/ims/productSku';
import { getCountryOptions } from '@/lib/ims/countryOptions';
import { calculatePosProfitability } from '@/lib/ims/posReturnCreditNote';
import { summarizeSalesOrderCogs } from '@/lib/ims/salesOrderCogs';
import { formatAuditDateTime } from '@/lib/ims/auditDateTime';
import { calculateSupplierCreditTotals, type SupplierCreditTaxTreatment } from '@/lib/ims/supplierCreditTotals';
import { audAmountFromPayment, canonicalExchangeRate, displayedExchangeRate, exchangeRateFromPaymentAmounts, type ExchangeRateDirection } from '@/lib/ims/foreignPaymentMath';
import { purchaseOrderCurrencyCost } from '@/lib/ims/purchaseOrderCurrencyCost';
import { sanitizePurchaseOrderWorkspace, type PurchaseOrderWorkspaceSettings } from '@/lib/ims/purchaseOrderWorkspace';
import { buildNotificationDetailSections } from '@/lib/ims/notificationPresentation';
import { visiblePosPaymentTotals } from '@/lib/ims/posSalesPaymentSummary';
import { parseProductSettings, PRODUCT_SETTING_KEYS } from '@/lib/ims/productSettings';
import { buildTaxSettingsUpdate, TAX_SETTING_DEFAULTS } from '@/lib/ims/taxSettings';
import { parseWebsiteJsonResponse } from '@/lib/website/httpJsonResponse';
import { selectProductResearchVariant } from '@/lib/website/productResearchRules';
import { WebsiteGeneratedContentEditor } from '@/components/website/WebsiteGeneratedContentEditor';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { SolvantisMark } from '@/components/SolvantisMark';
import { BusinessContextSwitcher } from '@/components/BusinessContextSwitcher';
import { UnifiedHelpDrawer } from '@/components/help/UnifiedHelpDrawer';
import { TeamCommunicationsDrawer } from '@/components/help/TeamCommunicationsDrawer';
import { getCollapsedSidebarAction, isSidebarSectionActive } from '@/lib/navigation/sidebarNavigation';
import {
  DEFAULT_XERO_DOCUMENT_POLICY,
  type XeroDocumentAction,
  type XeroDocumentPolicy,
  validateXeroDocumentPolicy,
} from '@/lib/xero/documentPolicies';
import { OrderPlannerView } from '../dashboard/OrderPlannerView';
import { MainSections } from './views/MainSections';
import { LoyaltySettingsSection } from './views/settings/LoyaltySettingsSection';
import { ShippingSettingsSection } from './views/settings/ShippingSettingsSection';
import { ShipOrdersWorkspace } from './views/orders/ShipOrdersWorkspace';
import { LocationDaybooksView } from './views/locations/LocationDaybooksView';
import { StockAvailabilityWorkbenchView } from './views/orders/StockAvailabilityWorkbenchView';
import { SalesByBranchView as SalesByBranchViewComponent } from './views/reports/SalesByBranchView';
import { SalesSearchView as SalesSearchViewComponent } from './views/reports/SalesSearchView';
import { SalesSummaryView as SalesSummaryViewComponent } from './views/reports/SalesSummaryView';
import { ReportScrollTable } from './views/reports/ReportScrollTable';
import { PosPriceChangesView as PosPriceChangesViewComponent } from './views/reports/PosPriceChangesView';
import { PosRegistersReportView as PosRegistersReportViewComponent } from './views/reports/PosRegistersReportView';
import { StockAvailabilityManagementView } from './views/reports/StockAvailabilityManagementView';
import { BookkeeperAuditView } from './views/reports/BookkeeperAuditView';
import { BulkAddEditProductsView } from './views/products/BulkAddEditProductsView';
import { ProductBuildsView } from './views/products/ProductBuildsView';
import { BuildRecipeEditor } from './views/products/BuildRecipeEditor';
import { NewProductChannelChoices, ProductChannelDestinations } from './views/products/ProductChannelDestinations';
import { SalesOrderFulfilmentModal } from './views/orders/SalesOrderFulfilmentModal';
import { SalesOrderCogsDetail, type SalesOrderCogsDisplayLine } from './views/orders/SalesOrderCogsDetail';
import { ResolveOutstandingModal } from './views/orders/ResolveOutstandingModal';
import { SalesOrderBatchMoveModal } from './views/orders/SalesOrderBatchMoveModal';
import { SalesOrderMoveItemsModal } from './views/orders/SalesOrderMoveItemsModal';
import { PurchaseOrderBatchMoveModal } from './views/orders/PurchaseOrderBatchMoveModal';
import { PurchaseOrderMoveItemsModal } from './views/orders/PurchaseOrderMoveItemsModal';
import { StockAllocationPanel } from './views/orders/StockAllocationPanel';
import { useTableArrowScroll } from './hooks/useTableArrowScroll';
import { ContactCrmTaskQueue, type ContactCrmWorkspaceTask } from './views/contacts/ContactCrmTaskQueue';
import { ContactCrmSegments } from './views/contacts/ContactCrmSegments';
import { ContactCrmPipeline } from './views/contacts/ContactCrmPipeline';
import { ContactCrmDataQuality } from './views/contacts/ContactCrmDataQuality';
import { ContactCrmAnalytics } from './views/contacts/ContactCrmAnalytics';
import { buildOrderEditOperationKey, buildOrderStatusOperationKey, buildPurchaseOrderReceiveOperationKey, buildPurchaseOrderUndoOperationKey, getDefaultEmailedSalesDocument, getOrderStatusLabel, getSalesDocumentFilename, isSalesDocumentAvailable, type OrderKind, type SOStatus, type SalesDocumentType } from '@/lib/ims/orderLifecyclePolicy';
import { buildInventoryDocumentOperationKey } from '@/lib/ims/inventoryDocumentLifecycle';
import { buildPartialReceiptHeaderUpdate, planPurchaseOrderReceive } from '@/lib/ims/purchaseOrderReceivePlan';
import { installSessionExpiredGuard, redirectToLogin } from '@/lib/auth/sessionGuard';
import {
  EMPTY_MULTI,
  MultiFilter,
  ReportMultiFilter,
  SBDatePicker,
  SBDateRange,
  WINDOW_OPTS,
  hasMultiFilter,
  multiFilterParams,
} from './views/reports/reportFilterHelpers';
import {
  getXeroHash,
  getXeroWorkspaceSection,
  isXeroHash,
  parseXeroHash,
  type XeroDestination,
  type XeroWorkspaceSection,
} from './views/xero/navigation';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ImsView =
  | 'dashboard' | 'products' | 'builds' | 'stock' | 'brands' | 'gift-cards' | 'bulk-edit' | 'bulk-add-edit'
  | 'contacts' | 'crm' | 'contact-profile' | 'wholesale-applications' | 'locations' | 'location-daybooks'
  | 'purchase-orders' | 'sales-orders' | 'stock-availability' | 'backorders' | 'customer-backorders' | 'supplier-backorders' | 'credit-notes' | 'supplier-credit-notes' | 'branch-transfers' | 'smart-device-receive' | 'order-planner'
  | 'receive-transfers'
  | 'pos-sales' | 'cash-banking' | 'online-sales' | 'stocktakes'
  | 'reports' | 'report-sales-detail' | 'report-sales-by-branch' | 'report-sales-summary' | 'report-sales-search' | 'report-inventory-valuation' | 'report-product-margin' | 'report-pos-price-changes' | 'report-pos-registers' | 'report-cash-banking' | 'report-stock-availability' | 'report-bookkeeper-audit'
  | 'xero' | 'sales-channels' | 'online-shop';

interface User { name: string; email: string; company: string; businessId: string; tier?: string; hasForesight?: boolean }

// ─────────────────────────────────────────────────────────────────────────────
// Nav structure
// ─────────────────────────────────────────────────────────────────────────────

const NAV = [
  { id: 'dashboard',       label: 'Dashboard',        section: null },
  { id: '__products',      label: 'Products',         section: 'products', children: [
    { id: 'products',      label: 'All Products' },
    { id: 'builds',        label: 'Builds' },
    { id: 'stock',         label: 'Stock Levels' },
    { id: 'brands',        label: 'Brands' },
    { id: 'gift-cards',    label: 'Gift Cards' },
    { id: 'bulk-edit',     label: 'Bulk Edit' },
    { id: 'bulk-add-edit', label: 'Bulk Add/Edit' },
  ]},
  { id: '__sales',         label: 'Sales',            section: 'sales', children: [
    { id: 'sales-orders',     label: 'Sales Orders' },
    { id: 'stock-availability', label: 'Stock Allocation' },
    { id: 'credit-notes',     label: 'Customer Credit Notes' },
    { id: 'pos-sales',            label: 'POS Sales' },
    { id: 'online-sales',     label: 'Online Sales' },
  ]},
  { id: '__purchasing',    label: 'Purchasing',       section: 'purchasing', children: [
    { id: 'purchase-orders',  label: 'Purchase Orders' },
    { id: 'order-planner',    label: 'Order Planner' },
    { id: 'supplier-credit-notes', label: 'Supplier Credit Notes' },
  ]},
  { id: '__contacts',      label: 'Contacts',         section: 'contacts', children: [
    { id: 'contacts',      label: 'Contacts' },
    { id: 'crm',           label: 'CRM' },
  ]},
  { id: '__locations',     label: 'Locations',        section: 'locations', children: [
    { id: 'locations',      label: 'Locations' },
    { id: 'location-daybooks', label: 'Location Daybooks' },
    { id: 'branch-transfers', label: 'Branch Transfers' },
    { id: 'receive-transfers', label: 'Receive Transfers' },
  ]},
  { id: 'stocktakes',       label: 'Stocktakes',       section: null },
  { id: '__reports',       label: 'Reports',          section: 'reports', children: [
    { id: 'reports', label: 'Reports Overview' },
    { id: 'inactive-candidates', label: 'Inactive Candidates', href: '/dashboard#inactive-candidates' },
    { id: 'lost-candidates', label: 'Possible Losses', href: '/dashboard#lost-candidates' },
    { id: 'space-analysis', label: 'Space Efficiency', href: '/dashboard#space-analysis' },
    { id: 'stock-turnover', label: 'Stock Turnover', href: '/dashboard#stock-turnover' },
  ]},
  { id: '__automation',    label: 'Automations',      section: 'automation', children: [
    { id: 'pending-online', label: 'Bulk Online Listing Generator', href: '/dashboard#pending-online' },
    { id: 'bulk-edit-listings', label: 'Bulk Edit Existing Listings', href: '/dashboard#bulk-edit-listings' },
    { id: '__business-profile', label: 'Business Profile', children: [
      { id: 'business-info', label: 'Business Key Information', href: '/dashboard#business-info' },
      { id: 'brand-profile', label: 'Brand Profile', href: '/dashboard#brand-profile' },
      { id: 'sync-data', label: 'Sync Data', href: '/dashboard#sync-data' },
      { id: 'calculated-data', label: 'Reports', href: '/dashboard#calculated-data' },
    ]},
    { id: '__brand-assets', label: 'Brand Assets', children: [
      { id: 'brand-assets-models', label: 'Models', href: '/dashboard#brand-assets-models' },
      { id: 'brand-assets-backdrops', label: 'Backdrops', href: '/dashboard#brand-assets-backdrops' },
      { id: 'brand-assets-poses', label: 'Poses', href: '/dashboard#brand-assets-poses' },
      { id: 'brand-assets-scenes', label: 'Scenes', href: '/dashboard#brand-assets-scenes' },
      { id: 'brand-assets-templates', label: 'Templates', href: '/dashboard#brand-assets-templates' },
    ]},
    { id: '__customer-service', label: 'Customer Service', children: [
      { id: 'cs-inbox', label: 'Inbox', href: '/dashboard#cs-inbox' },
      { id: 'cs-compose', label: 'Compose Email', href: '/dashboard#cs-compose' },
      { id: 'cs-templates', label: 'Email Templates', href: '/dashboard#cs-templates' },
    ]},
  ]},
  { id: '__settings',      label: 'Settings',         section: 'settings', children: [
    { id: 'connections', label: 'Connections', href: '/dashboard?settings=connections' },
    { id: 'data-source', label: 'Data Source', href: '/dashboard?settings=data-source' },
    { id: 'product-description-template', label: 'Web Field Templates', href: '/dashboard?settings=product-description-template' },
  ]},
  { id: '__finances',       label: 'Finances',         section: 'finances', children: [
    { id: 'report-bookkeeper-audit', label: 'Accounting Audit' },
    { id: 'cash-banking',            label: 'Cash Banking' },
    { id: 'xero',                    label: 'Xero Integration' },
  ]},
  { id: '__integrations',   label: 'Integrations',     section: 'integrations', children: [
    { id: 'sales-channels', label: 'Sales Channels' },
    { id: 'online-shop',    label: 'Online Shop' },
  ]},
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtCurrency = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtFx = (n: number | null | undefined, currency?: string) => {
  if (n == null) return '—';
  const num = Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (!currency || currency === 'AUD') ? `$${num}` : `${currency} ${num}`;
};

const normalizeDisplayFxRate = (currency?: string, exchangeRate?: number | string | null) => {
  const cur = (currency ?? 'AUD').toUpperCase();
  const rate = Number(exchangeRate ?? 1);
  if (cur === 'AUD' || !Number.isFinite(rate) || rate <= 0) return 1;
  return rate;
};

const displayForeignCurrencyAmount = (amount: number | null | undefined, currency?: string, _exchangeRate?: number | string | null) => {
  const cur = (currency ?? 'AUD').toUpperCase();
  const raw = Number(amount ?? 0);
  if (cur === 'AUD' || !Number.isFinite(raw) || raw === 0) return raw;
  return raw;
};

const fmtQty = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('en-AU', { maximumFractionDigits: 4 });

// Returns today's calendar date as YYYY-MM-DD in the business timezone.
// Using 'sv-SE' locale gives the ISO YYYY-MM-DD format; explicit TZ prevents
// the UTC off-by-one error that affects Australian evenings (UTC+10/+11).
let activeBusinessTimeZone = 'Australia/Sydney';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: activeBusinessTimeZone });

const daysAgoSydney = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('sv-SE', { timeZone: activeBusinessTimeZone });
};

const DEFAULT_DATE_RANGE: SBDateRange = { kind: 'window', window: 90, label: '90 Days' };

function toYmd(value: any): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function inDateRange(value: any, range: SBDateRange): boolean {
  const ymd = toYmd(value);
  if (!ymd) return false;
  if (range.kind === 'range') {
    const low = range.from <= range.to ? range.from : range.to;
    const high = range.from <= range.to ? range.to : range.from;
    return ymd >= low && ymd <= high;
  }
  const low = daysAgoSydney(Math.max(0, Number(range.window || 0) - 1));
  const high = today();
  return ymd >= low && ymd <= high;
}

const PAYMENT_TERMS = ['', '10 Days', '15 Days', '30 Days', '30 EOM', '60 Days', '90 Days', 'COD'];
const PO_CURRENCIES = ['AUD', 'USD', 'EUR', 'GBP', 'THB', 'CNY', 'JPY', 'INR', 'CAD', 'NZD'];

function effectiveRRP(v: any, today: string): number {
  if (v.price_rrp_sale && Number(v.price_rrp_sale) > 0) {
    const start = v.discount_start_date ?? '';
    const end = v.discount_end_date ?? '';
    if ((!start || today >= start) && (!end || today <= end)) {
      return Number(v.price_rrp_sale);
    }
  }
  return Number(v.price_rrp ?? 0);
}

function useLocationSoh(locationId: string | number | null | undefined) {
  const [sohByVariant, setSohByVariant] = React.useState<Record<string, number> | null>(null);

  React.useEffect(() => {
    if (!locationId) {
      setSohByVariant(null);
      return;
    }
    const controller = new AbortController();
    setSohByVariant(null);
    fetch(`/api/ims/stock?location_id=${encodeURIComponent(String(locationId))}`, { signal: controller.signal })
      .then(response => response.json())
      .then(result => {
        if (!result.success || !Array.isArray(result.data)) return;
        setSohByVariant(Object.fromEntries(result.data.map((row: any) => [String(row.variant_id), Number(row.qty_on_hand ?? 0)])));
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setSohByVariant(null);
      });
    return () => controller.abort();
  }, [locationId]);

  return sohByVariant;
}

// Searchable variant picker for document line items
function VariantSearch({ value, variants, onChange, style, testId, sohByVariant, disabled = false }: {
  value: string;
  variants: any[];
  onChange: (variant_id: string) => void;
  style?: React.CSSProperties;
  testId?: string;
  sohByVariant?: Record<string, number> | null;
  disabled?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [dropPos, setDropPos] = React.useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 320 });
  const ref = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = variants.find(v => v.variant_id === value);
  const displayLabel = selected
    ? `${selected.product_name} · ${selected.sku || ''} ${[selected.option1_value, selected.option2_value].filter(Boolean).join('/')}`.trim()
    : '';

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return variants.slice(0, 80);
    return variants.filter(v => {
      const text = `${v.product_name ?? ''} ${v.sku ?? ''} ${v.barcode ?? ''} ${v.option1_value ?? ''} ${v.option2_value ?? ''}`.toLowerCase();
      return text.includes(q);
    }).slice(0, 60);
  }, [query, variants]);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function openDropdown() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX, width: Math.max(rect.width, 320) });
    }
    setQuery('');
    setOpen(true);
  }

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        data-testid={testId}
        type="text"
        disabled={disabled}
        value={open ? query : displayLabel}
        title={!open && displayLabel ? displayLabel : undefined}
        placeholder="Search variant…"
        onFocus={openDropdown}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        style={{ ...inputStyle, fontSize: 12, width: '100%' }}
      />
      {open && (
        <div style={{
          position: 'fixed',
          top: dropPos.top,
          left: dropPos.left,
          zIndex: 99999,
          width: dropPos.width,
          maxWidth: 480,
          maxHeight: 260,
          overflowY: 'auto',
          background: 'var(--sv-bg-2)',
          border: '1px solid var(--sv-etch)',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--sv-text-dim)' }}>No matches</div>
          )}
          {filtered.map(v => (
            <div
              key={v.variant_id}
              data-testid={testId ? `${testId}-option-${v.variant_id}` : undefined}
              onMouseDown={() => { onChange(v.variant_id); setOpen(false); setQuery(''); }}
              style={{
                padding: '7px 12px', cursor: 'pointer', fontSize: 12,
                background: v.variant_id === value ? 'var(--sv-action-dim, rgba(99,102,241,0.1))' : undefined,
                borderBottom: '1px solid var(--sv-etch)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--sv-bg-1)')}
              onMouseLeave={e => (e.currentTarget.style.background = v.variant_id === value ? 'var(--sv-action-dim, rgba(99,102,241,0.1))' : '')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{v.product_name}</span>
                {v.sku && <span style={{ color: 'var(--sv-text-dim)' }}>{v.sku}</span>}
                {[v.option1_value, v.option2_value].filter(Boolean).length > 0 && (
                  <span style={{ color: 'var(--sv-text-dim)' }}>{[v.option1_value, v.option2_value].filter(Boolean).join(' / ')}</span>
                )}
                {sohByVariant && (
                  <span style={{ color: 'var(--sv-text-dim)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>SOH: {sohByVariant[String(v.variant_id)] ?? 0}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function calcDueDate(orderDate: string | undefined, terms: string | undefined): string {
  if (!terms) return '—';
  if (terms === 'COD') return 'Cash on Delivery';
  const daysMatch = terms.match(/\d+/);
  const days = daysMatch ? parseInt(daysMatch[0], 10) : NaN;
  if (!orderDate || isNaN(days)) return '—';
  const d = new Date(orderDate);
  if (/\beom\b/i.test(terms)) {
    d.setMonth(d.getMonth() + 1, 0);
  }
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  const json = await res.json();
  if (!json.success && json.error) throw new Error(json.error);
  return json;
}

function CostSummaryPills({ items }: { items: Array<{ label: string; value: string; tone?: 'default' | 'good' | 'warn' | 'bad' }> }) {
  const toneColor = (tone?: 'default' | 'good' | 'warn' | 'bad') => {
    if (tone === 'good') return 'var(--sv-mint,#0c9)';
    if (tone === 'warn') return 'var(--sv-amber,#f59e0b)';
    if (tone === 'bad') return 'var(--sv-red,#e05)';
    return 'var(--sv-text-main)';
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{it.label}</span>
          <span style={{ fontSize: 12, color: toneColor(it.tone), fontWeight: 700 }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared settings hook  (fetches ims_settings for the current business)
// ─────────────────────────────────────────────────────────────────────────────

type ImsCapabilities = {
  hasPosLocations: boolean;
  xeroAccountingEnabled: boolean;
  shopifyEnabled: boolean;
  nativeShopEnabled: boolean;
};

const IMS_SETTINGS_UPDATED_EVENT = 'solvantis:ims-settings-updated';

function useImsSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const settingsRef = useRef<Record<string, string>>({});
  const [capabilities, setCapabilities] = useState<ImsCapabilities>({
    hasPosLocations: false,
    xeroAccountingEnabled: false,
    shopifyEnabled: false,
    nativeShopEnabled: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const fetchSettings = useCallback(() => {
    setLoaded(false);
    setLoadError('');
    fetch('/api/ims/settings').then(async response => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Settings could not be loaded.');
      activeBusinessTimeZone = data.data?.business_timezone || 'Australia/Sydney';
      settingsRef.current = data.data || {};
      setSettings(settingsRef.current);
      setCapabilities({
        hasPosLocations: Boolean(data.capabilities?.hasPosLocations),
        xeroAccountingEnabled: Boolean(data.capabilities?.xeroAccountingEnabled),
        shopifyEnabled: Boolean(data.capabilities?.shopifyEnabled),
        nativeShopEnabled: Boolean(data.capabilities?.nativeShopEnabled),
      });
      setLoaded(true);
    }).catch(error => setLoadError(error instanceof Error ? error.message : 'Settings could not be loaded.'));
  }, []);
  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => {
    const refresh = () => fetchSettings();
    window.addEventListener(IMS_SETTINGS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(IMS_SETTINGS_UPDATED_EVENT, refresh);
  }, [fetchSettings]);
  const saveSettings = useCallback(async (updates: Record<string, string>) => {
    const response = await fetch('/api/ims/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: updates }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) throw new Error(data?.error || 'Settings could not be saved.');
    if (updates.business_timezone) activeBusinessTimeZone = updates.business_timezone;
    window.dispatchEvent(new Event(IMS_SETTINGS_UPDATED_EVENT));
  }, []);
  const saveOnlineChannels = useCallback(async (onlineChannels: Pick<ImsCapabilities, 'shopifyEnabled' | 'nativeShopEnabled'>) => {
    const response = await fetch('/api/ims/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onlineChannels }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Online channel settings could not be saved.');
    window.dispatchEvent(new Event(IMS_SETTINGS_UPDATED_EVENT));
  }, []);
  return { settings, capabilities, loaded, loadError, saveSettings, saveOnlineChannels, refetchSettings: fetchSettings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:              'background:rgba(100,116,139,.18);color:#94a3b8',
  confirmed:          'background:rgba(37,99,235,.18);color:#60a5fa',
  awaiting_product:   'background:rgba(37,99,235,.18);color:#60a5fa',
  partially_received: 'background:rgba(251,146,60,.18);color:#f97316',
  received:           'background:rgba(16,185,129,.18);color:#34d399',
  complete:           'background:rgba(16,185,129,.18);color:#34d399',
  fulfilled:          'background:rgba(16,185,129,.18);color:#34d399',
  sent:               'background:rgba(139,92,246,.18);color:#a78bfa',
  partial:            'background:rgba(251,146,60,.18);color:#f97316',
  cancelled:          'background:rgba(248,113,113,.15);color:#f87171',
  in_progress:        'background:rgba(251,191,36,.15);color:#fbbf24',
  completed:          'background:rgba(16,185,129,.18);color:#34d399',
  reverted:           'background:rgba(139,92,246,.18);color:#a78bfa',
  reversed:           'background:rgba(139,92,246,.18);color:#a78bfa',
};

function StatusBadge({ status, orderKind }: { status: string; orderKind?: OrderKind }) {
  const style = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  const label = orderKind
    ? getOrderStatusLabel(orderKind, status as any)
    : status.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  return (
    <span style={{ ...parseStyleStr(style), padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function parseStyleStr(s: string): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const part of s.split(';')) {
    const [k, v] = part.split(':');
    if (k && v) obj[k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v.trim();
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide, wider, width, zIndex = 1000 }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; wider?: boolean; width?: number; zIndex?: number;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 40, paddingBottom: 40, background: 'rgba(0,0,0,.6)', overflowY: 'auto' }}>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 12, width: width ?? (wider ? 1360 : wide ? 1180 : 620), maxWidth: 'calc(100vw - 48px)', boxSizing: 'border-box', padding: 28, position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--sv-text-dim)', cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Field helpers
// ─────────────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', background: 'var(--sv-bg-2)',
  border: '1px solid var(--sv-etch)', borderRadius: 6, color: 'var(--sv-text-main)',
  fontSize: 14, boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--sv-text-dim)', marginBottom: 4, display: 'block' };

function Field({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--sv-text-dim)', margin: '14px 0 6px' }}>
      {children}
    </div>
  );
}

function DetailSectionDivider({ label, summary, action, marginTop = 24 }: {
  label: string;
  summary?: React.ReactNode;
  action?: React.ReactNode;
  marginTop?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: `${marginTop}px 0 14px` }}>
      <div style={{ flex: 1, height: 1, background: 'var(--sv-etch)' }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: .8, whiteSpace: 'nowrap' }}>{label}</span>
      {summary && <span style={{ fontSize: 11, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{summary}</span>}
      {action}
      <div style={{ flex: 1, height: 1, background: 'var(--sv-etch)' }} />
    </div>
  );
}

function PurchaseOrderFinancialSections({ payments, landedCosts }: { payments: React.ReactNode; landedCosts: React.ReactNode }) {
  return <>{payments}{landedCosts}</>;
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

function Row3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function Sidebar({ active, onSelect, userTier }: { active: ImsView; onSelect: (v: ImsView) => void; userTier?: string }) {
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({ __products: false, __sales: false, __purchasing: false, __contacts: false, __locations: false, __reports: false, __automation: false, __settings: false, __finances: false, __integrations: false });
  const [nestedOpen, setNestedOpen] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(false);
  const { settings: sidebarSettings, capabilities } = useImsSettings();
  const showMultipleLocations = sidebarSettings.use_multiple_locations !== 'no';
  const showBuilds = sidebarSettings.builds_enabled === 'yes';
  const showWholesale = sidebarSettings.sells_wholesale !== 'no';
  const showLocationDaybooks = sidebarSettings.business_requires_pos !== 'no' || capabilities.hasPosLocations;
  const showXero = capabilities.xeroAccountingEnabled;
  const showNativeShop = capabilities.nativeShopEnabled;
  const showLocations = showMultipleLocations || showLocationDaybooks;
  const showWholesalePreview = showWholesale && (userTier === 'Admin' || userTier === 'SuperAdmin');

  const toggleSection = (id: string) => setSectionOpen(prev => {
    const shouldOpen = !prev[id];
    const next: Record<string, boolean> = {};
    for (const key of Object.keys(prev)) next[key] = key === id ? shouldOpen : false;
    return next;
  });

  const openOnlySection = (id: string) => setSectionOpen(prev => {
    const next: Record<string, boolean> = {};
    for (const key of Object.keys(prev)) next[key] = key === id;
    return next;
  });

  const itemContainsActiveView = (item: typeof NAV[number]) => {
    const aliases = [
      ...(item.id === '__sales' ? ['wholesale-applications'] : []),
      ...(item.id === '__contacts' ? ['contact-profile'] : []),
      ...(item.id === '__reports' && active.startsWith('report-') && active !== 'report-bookkeeper-audit' ? [active] : []),
    ];
    return isSidebarSectionActive(item, active, aliases);
  };

  const selectCollapsedItem = (item: typeof NAV[number]) => {
    const action = getCollapsedSidebarAction(item);
    setCollapsed(false);
    if (action.openSection) openOnlySection(action.openSection);
    if (action.navigateTo) onSelect(action.navigateTo as ImsView);
  };

  const ICONS: Record<string, string> = {
    dashboard:          'M3 12l2-2m0 0l7-7 7 7m-14 0v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9m-14 0h14',
    __products:         'M20 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2',
    products:           'M20 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2',
    stock:              'M3 6h18M3 10h18M3 14h18M3 18h18',
    brands:             'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z',
    'gift-cards':       'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    __sales:            'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 5h12',
    __purchasing:       'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
    __locations:        'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
    'purchase-orders':  'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 12h6M9 16h4',
    'sales-orders':     'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 5h12',
    'branch-transfers': 'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4',
    'pos-sales':        'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
    'online-sales':     'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9',
    'order-planner':    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 12h6M9 16h4',
    __contacts:         'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    contacts:           'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    locations:          'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
    stocktakes:         'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 12l2 2 4-4',
    reports:            'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    __reports:          'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    __automation:      'M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
    __settings:        'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82',
    __finances:         'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
    __integrations:     'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
    'sales-channels':   'M3 7h18M5 7l1-4h12l1 4M5 7v13h14V7M9 20v-6h6v6',
    xero:               'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
    settings:           'M12 15a3 3 0 100-6 3 3 0 000 6z',
  };

  const NavIcon = ({ id }: { id: string }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {ICONS[id] && <path d={ICONS[id]} />}
    </svg>
  );

  const collapsedItemStyle = (isActive: boolean): React.CSSProperties => ({
    width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none', cursor: 'pointer',
    borderLeft: isActive ? '3px solid var(--sv-action)' : '3px solid transparent',
    backgroundColor: isActive ? 'rgba(37,99,235,.12)' : 'transparent',
    color: isActive ? 'var(--sv-action)' : 'var(--sv-text-dim)',
  });

  return (
    <aside style={{ width: collapsed ? 52 : 220, flexShrink: 0, background: '#f1f3f5', border: '1px solid #dfe3e8', borderRadius: 0, display: 'flex', flexDirection: 'column', padding: '12px 0 10px', transition: 'width .2s ease', overflow: 'hidden' }}>
      {/* Header row: IMS label + collapse toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', padding: collapsed ? '0 0 16px' : '0 10px 12px 14px', borderBottom: '1px solid #dfe3e8', marginBottom: 8 }}>
        {!collapsed && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: '#475569', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>IMS</div>}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
          </svg>
        </button>
      </div>

      {/* Collapsed navigation mirrors the same top-level items as expanded navigation. */}
      {collapsed && NAV.filter(item => item.id !== '__locations' || showLocations).map(item => (
          <button key={item.id} data-testid={`ims-nav-${item.id}`} onClick={() => selectCollapsedItem(item)} title={`${item.label} — expand sidebar`}
            style={collapsedItemStyle(itemContainsActiveView(item))}>
            <NavIcon id={item.id} />
          </button>
      ))}

      {/* Nav items — expanded */}
      {!collapsed && NAV.filter(item => item.id !== '__locations' || showLocations).map(item => {
        const visibleChildren = 'children' in item
          ? (item as any).children.filter((child: any) => {
            if (child.id === 'location-daybooks') return showLocationDaybooks;
            if (child.id === 'builds') return showBuilds;
            if (child.id === 'branch-transfers' || child.id === 'receive-transfers') return showMultipleLocations;
            if (child.id === 'xero' || child.id === 'cash-banking') return showXero;
            if (child.id === 'sales-channels') return true;
            if (child.id === 'online-shop') return showNativeShop;
            return true;
          })
          : [];
        const hasChildren = visibleChildren.length > 0;
        const isGroupOpen = sectionOpen[item.id];
        const isActive = active === item.id;
        const isMainActive = itemContainsActiveView(item);

        // Expanded mode
        return (
          <div key={item.id} style={{ marginBottom: 2 }}>
            <button
              data-testid={`ims-nav-${item.id}`}
              onClick={() => { if (hasChildren) toggleSection(item.id); else onSelect(item.id as ImsView); }}
              style={{
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 14px 8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                color: isMainActive ? '#0f172a' : '#334155',
                backgroundColor: isActive && !hasChildren ? '#e8edf1' : (hasChildren && isGroupOpen ? '#e8edf1' : 'transparent'),
                textAlign: 'left', fontSize: 14, fontWeight: isMainActive ? 700 : 600,
                borderLeft: '3px solid transparent',
                borderRadius: 6,
                transition: 'all .15s',
              }}
            >
              <span style={{ color: isMainActive ? '#1ea8c2' : '#334155', display: 'inline-flex', alignItems: 'center' }}>
                <NavIcon id={item.id} />
              </span>
              <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{item.label}</span>
              {hasChildren && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ transform: isGroupOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s', opacity: .75, flexShrink: 0 }}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </button>
            {hasChildren && isGroupOpen && (
              <div style={{ marginLeft: 16, marginRight: 10, marginTop: 2, marginBottom: 4, borderLeft: '1px solid #dfe3e8', background: 'rgba(148,163,184,.04)', borderRadius: 0, overflow: 'hidden' }}>
                {visibleChildren.map((child: any) => child.href ? (
                  <a key={child.id} data-testid={`ims-nav-${child.id}`} href={child.href}
                    onClick={() => openOnlySection(item.id)}
                    style={{
                      display: 'flex', alignItems: 'center', textDecoration: 'none',
                      padding: '7px 12px 7px 18px', color: '#475569', fontSize: 13, fontWeight: 500,
                      borderLeft: '3px solid transparent', borderRadius: 0,
                    }}
                  >{child.label}</a>
                ) : child.children?.length ? (
                  <React.Fragment key={child.id}>
                    <button type="button" data-testid={`ims-nav-${child.id}`} aria-expanded={Boolean(nestedOpen[child.id])}
                      onClick={() => setNestedOpen(previous => ({ ...previous, [child.id]: !previous[child.id] }))}
                      style={{
                        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                        padding: '7px 12px 7px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        color: '#475569', fontSize: 13, fontWeight: 550, textAlign: 'left',
                      }}
                    >
                      {child.label}
                      <span aria-hidden="true" style={{ color: '#94a3b8', fontSize: 11 }}>{nestedOpen[child.id] ? '▾' : '▸'}</span>
                    </button>
                    {nestedOpen[child.id] && child.children.map((grandchild: any) => (
                      <a key={grandchild.id} data-testid={`ims-nav-${grandchild.id}`} href={grandchild.href}
                        onClick={() => openOnlySection(item.id)}
                        style={{
                          display: 'block', textDecoration: 'none',
                          padding: '6px 12px 6px 30px', color: '#64748b', fontSize: 12, fontWeight: 400,
                          lineHeight: 1.4, borderLeft: '3px solid transparent',
                        }}
                      >{grandchild.label}</a>
                    ))}
                  </React.Fragment>
                ) : (
                  <button key={child.id} data-testid={`ims-nav-${child.id}`} onClick={() => { openOnlySection(item.id); onSelect(child.id as ImsView); }}
                    style={{
                      width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                      padding: '7px 12px 7px 18px', display: 'flex', alignItems: 'center',
                      color: active === child.id ? '#0f172a' : '#475569',
                      backgroundColor: active === child.id ? '#e8edf1' : 'transparent',
                      fontSize: 13, fontWeight: active === child.id ? 700 : 500,
                      textAlign: 'left',
                      borderLeft: '3px solid transparent',
                      borderRadius: 0,
                    }}
                  >{child.label}</button>
                ))}
                {item.id === '__sales' && showWholesalePreview && (
                  <a href="/wholesale/preview" target="_blank" rel="noopener noreferrer" data-testid="ims-nav-wholesale-portal"
                    style={{ padding: '7px 12px 7px 18px', display: 'flex', alignItems: 'center', color: '#475569', fontSize: 13, fontWeight: 500, textDecoration: 'none' }}>
                    <span style={{ flex: 1 }}>Preview Wholesale Portal</span><span aria-hidden="true">↗</span>
                  </a>
                )}
                {item.id === '__sales' && showWholesale && (
                  <button data-testid="ims-nav-wholesale-applications" onClick={() => { openOnlySection(item.id); onSelect('wholesale-applications'); }}
                    style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 12px 7px 18px', display: 'flex', alignItems: 'center', color: active === 'wholesale-applications' ? '#0f172a' : '#475569', backgroundColor: active === 'wholesale-applications' ? '#e8edf1' : 'transparent', fontSize: 13, fontWeight: active === 'wholesale-applications' ? 700 : 500, textAlign: 'left', borderLeft: '3px solid transparent' }}>
                    Wholesale Applications
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ flex: 1 }} />
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard View
// ─────────────────────────────────────────────────────────────────────────────

type ImsOnboardingAction =
  | { type: 'nav'; view: ImsView; label: string }
  | { type: 'settings'; section: string; label: string };

const IMS_ONBOARDING_ACTIONS: Record<string, ImsOnboardingAction> = {
  business_profile: { type: 'settings', section: 'business-profile', label: 'Open Business Profile' },
  operations_tax:   { type: 'settings', section: 'general',          label: 'Open IMS Settings' },
  online_shop:      { type: 'nav',      view: 'online-shop',         label: 'Open Online Shop' },
  accounting:       { type: 'nav',      view: 'xero',                label: 'Open Xero' },
  users:            { type: 'settings', section: 'users',            label: 'Add Users' },
  locations:        { type: 'nav',      view: 'locations',           label: 'Add Locations' },
  brands:           { type: 'nav',      view: 'brands',              label: 'Add Brands' },
  suppliers:        { type: 'nav',      view: 'contacts',            label: 'Add Suppliers' },
  products:         { type: 'nav',      view: 'products',            label: 'Import Products' },
  sales_orders:     { type: 'nav',      view: 'sales-orders',        label: 'Import Sales Orders' },
  purchase_orders:  { type: 'nav',      view: 'purchase-orders',     label: 'Import Purchase Orders' },
  opening_stock:    { type: 'settings', section: 'sync',             label: 'Opening Stock Snapshot' },
  pos_ready:        { type: 'settings', section: 'pos',              label: 'Review POS Setup' },
};
function DashboardPanelHeading({ eyebrow, title, style, titleColor = 'var(--sv-text-strong)' }: { eyebrow: string; title: string; style?: React.CSSProperties; titleColor?: string }) {
  return (
    <div style={style}>
      <div style={{ marginBottom: 2, color: 'var(--sv-action)', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{eyebrow}</div>
      <div style={{ color: titleColor, fontSize: 16, fontWeight: 750 }}>{title}</div>
    </div>
  );
}

function TotalSalesProfitCircle({ rows, itemCount, periodLabel, loading }: { rows: any[]; itemCount: number; periodLabel: string; loading: boolean }) {
  const totalSales = rows.reduce((sum, row) => sum + Number(row?.total ?? 0), 0);
  const totalGrossProfit = rows.reduce((sum, row) => sum + Number(row?.gross_profit ?? 0), 0);
  const totalOrderCount = rows.reduce((sum, row) => sum + Number(row?.order_count ?? 0), 0);
  const averageOrderValue = totalOrderCount > 0 ? totalSales / totalOrderCount : 0;
  const profitShare = totalSales > 0 ? Math.max(0, Math.min(1, totalGrossProfit / totalSales)) : 0;
  const marginPercent = profitShare * 100;
  const outerRadius = 105;
  const innerRadius = outerRadius * Math.sqrt(profitShare);
  if (loading) {
    return (
      <div style={{ height: 450, padding: '18px 20px', boxSizing: 'border-box', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10 }}>
        <DashboardPanelHeading eyebrow="Sales snapshot" title={`Total Sales vs Gross Profit - ${periodLabel}`} />
        <div style={{ height: 'calc(100% - 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
      </div>
    );
  }

  if (!rows.length || totalSales <= 0) {
    return (
      <div style={{ height: 450, padding: '18px 20px', boxSizing: 'border-box', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10 }}>
        <DashboardPanelHeading eyebrow="Sales snapshot" title={`Total Sales vs Gross Profit - ${periodLabel}`} />
        <div style={{ height: 'calc(100% - 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>No sales in this period.</div>
      </div>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ position: 'relative', height: 450, boxSizing: 'border-box', containerType: 'inline-size', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <DashboardPanelHeading eyebrow="Sales snapshot" title={`Total Sales vs Gross Profit - ${periodLabel}`} style={{ position: 'absolute', top: 14, left: 20, right: 20 }} />
        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(210px, 1.25fr) minmax(125px, .8fr) minmax(155px, 1fr)', alignItems: 'center', paddingTop: 30 }}>
          <div style={{ minWidth: 210, textAlign: 'center' }}>
            <svg viewBox="0 0 250 250" role="img" aria-label={`Total sales ${fmtCurrency(totalSales)}, gross profit ${fmtCurrency(totalGrossProfit)}, margin ${marginPercent.toFixed(1)} percent`} style={{ width: '100%', maxHeight: 270, display: 'block' }}>
              <circle cx="125" cy="125" r={outerRadius} fill="#25364d" />
              <circle cx="125" cy="125" r={innerRadius} fill="#58c7b5" stroke="rgba(255,255,255,.7)" strokeWidth="2" />
              <text x="125" y="120" textAnchor="middle" fill="#102a2d" fontSize="27" fontWeight="800">{marginPercent.toFixed(1)}%</text>
              <text x="125" y="140" textAnchor="middle" fill="#102a2d" fillOpacity=".78" fontSize="10" fontWeight="700">GROSS MARGIN</text>
            </svg>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 18, marginTop: 7 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--sv-text-dim)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#25364d' }} /> Total sales
                </div>
                <div style={{ marginTop: 4, color: 'var(--sv-text-strong)', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtCurrency(totalSales)}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--sv-text-dim)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#58c7b5' }} /> Gross profit
                </div>
                <div style={{ marginTop: 4, color: 'var(--sv-text-strong)', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtCurrency(totalGrossProfit)}</div>
              </div>
            </div>
          </div>
          <div style={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'clamp(24px, 4cqw, 44px)', padding: 'clamp(10px, 2cqw, 26px)', borderLeft: '1px solid var(--sv-etch)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--sv-text-strong)', fontSize: 'clamp(26px, 4cqw, 42px)', lineHeight: 1, fontWeight: 800 }}>{totalOrderCount.toLocaleString('en-AU')}</div>
              <div style={{ marginTop: 'clamp(7px, 1cqw, 12px)', color: 'var(--sv-text-dim)', fontSize: 'clamp(10px, 1.25cqw, 13px)', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Sales count</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--sv-text-strong)', fontSize: 'clamp(26px, 4cqw, 42px)', lineHeight: 1, fontWeight: 800 }}>{Number(itemCount).toLocaleString('en-AU', { maximumFractionDigits: 2 })}</div>
              <div style={{ marginTop: 'clamp(7px, 1cqw, 12px)', color: 'var(--sv-text-dim)', fontSize: 'clamp(10px, 1.25cqw, 13px)', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Number of items</div>
            </div>
          </div>
          <div style={{ alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'clamp(10px, 2cqw, 28px)', borderLeft: '1px solid var(--sv-etch)' }}>
            <div style={{ color: 'var(--sv-text-strong)', fontSize: 'clamp(36px, 5.5cqw, 58px)', lineHeight: 1, fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtCurrency(averageOrderValue)}</div>
            <div style={{ marginTop: 'clamp(10px, 1.4cqw, 16px)', color: 'var(--sv-text-dim)', fontSize: 'clamp(11px, 1.35cqw, 14px)', fontWeight: 800, textTransform: 'uppercase' }}>AOV</div>
            <div style={{ marginTop: 6, color: 'var(--sv-text-dim)', fontSize: 'clamp(10px, 1.2cqw, 13px)', textAlign: 'center' }}>Average order value</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardView({ businessId, xeroAccountingEnabled, shopifyEnabled, nativeShopEnabled, onNav, onOpenSettings, onOpenSalesOrder }: { businessId: string; xeroAccountingEnabled: boolean; shopifyEnabled: boolean; nativeShopEnabled: boolean; onNav: (v: ImsView) => void; onOpenSettings?: (section: string) => void; onOpenSalesOrder?: (id: number) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [salesWindow, setSalesWindow] = useState<'today' | 'yesterday' | '30' | '120' | '365'>('today');
  const [openOnlineSales, setOpenOnlineSales] = useState<any[]>([]);
  const [openOnlineSalesLoading, setOpenOnlineSalesLoading] = useState(false);
  const [openOnlineSalesModalOpen, setOpenOnlineSalesModalOpen] = useState(false);
  const [onboarding, setOnboarding] = useState<any>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingDraft, setOnboardingDraft] = useState<Record<string, string>>({});
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const onboardingAutoOpenedRef = useRef(false);
  const [salesData, setSalesData] = useState<any>(null);
  const [salesLoading, setSalesLoading] = useState(true);
  const channelChartRef = useRef<HTMLDivElement | null>(null);
  const [channelHover, setChannelHover] = useState<null | {
    x: number;
    y: number;
    channel: string;
    location: string;
    sales: number;
    tax: number;
    cogs: number;
    grossProfit: number;
    orders: number;
  }>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/ims/dashboard').then(r => r.json()).then(d => {
      if (d.success) setData(d.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSalesLoading(true);
    const query = salesWindow === 'yesterday' ? 'window=yesterday' : `days=${salesWindow === 'today' ? 1 : salesWindow}`;
    fetch(`/api/ims/dashboard/sales?${query}`).then(r => r.json()).then(d => {
      if (d.success) setSalesData(d);
    }).finally(() => setSalesLoading(false));
  }, [salesWindow]);

  useEffect(() => {
    setOpenOnlineSalesLoading(true);
    fetch('/api/ims/online-sales/open')
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.orders)) setOpenOnlineSales(d.orders);
      })
      .catch(() => {})
      .finally(() => setOpenOnlineSalesLoading(false));
  }, []);

  const loadOnboarding = useCallback(() => {
    setOnboardingLoading(true);
    fetch('/api/onboarding')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.success) return;
        setOnboarding(d);
        setOnboardingDraft({
          ...(d.settings ?? {}),
          shopify_enabled: shopifyEnabled ? 'yes' : 'no',
          native_shop_enabled: nativeShopEnabled ? 'yes' : 'no',
        });
        if (!d.complete && !onboardingAutoOpenedRef.current) {
          onboardingAutoOpenedRef.current = true;
          setOnboardingOpen(true);
        }
        if (d.complete) setOnboardingOpen(false);
      })
      .catch(() => {})
      .finally(() => setOnboardingLoading(false));
  }, [nativeShopEnabled, shopifyEnabled]);

  useEffect(() => { loadOnboarding(); }, [loadOnboarding]);

  const saveOnboardingStep = async (stepId: string, settings: Record<string, string>) => {
    setOnboardingSaving(true);
    try {
      const { shopify_enabled, native_shop_enabled, ...tenantSettings } = settings;
      if (stepId === 'integrations') {
        const capabilityResponse = await fetch('/api/ims/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onlineChannels: {
            shopifyEnabled: shopify_enabled === 'yes',
            nativeShopEnabled: native_shop_enabled === 'yes',
          } }),
        });
        if (!capabilityResponse.ok) throw new Error((await capabilityResponse.json().catch(() => ({}))).error ?? 'Online channel settings could not be saved.');
        window.dispatchEvent(new Event(IMS_SETTINGS_UPDATED_EVENT));
      }
      const response = await fetch('/api/onboarding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: tenantSettings, completeStep: stepId }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Onboarding details could not be saved.');
      loadOnboarding();
    } finally { setOnboardingSaving(false); }
  };

  const completeOnboardingStep = async (stepId: string) => {
    setOnboardingSaving(true);
    try {
      await fetch('/api/onboarding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completeStep: stepId }),
      });
      loadOnboarding();
    } finally { setOnboardingSaving(false); }
  };

  const setOnboardingField = (key: string, value: string) => setOnboardingDraft(p => ({ ...p, [key]: value }));

  const runOnboardingAction = (stepId: string) => {
    const action = IMS_ONBOARDING_ACTIONS[stepId];
    if (!action) return;
    setOnboardingOpen(false);
    if (action.type === 'nav') onNav(action.view);
    else onOpenSettings?.(action.section);
  };

  const fmtCompact = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K` : fmtCurrency(n);
  const stats: { label: string; value?: number; display?: React.ReactNode; color: string; nav?: ImsView; onClick?: () => void }[] = [
    { label: 'Products',    value: data?.products  ?? 0,                          color: 'var(--sv-action)', nav: 'products' as ImsView },
    { label: 'Open Online Sales', value: openOnlineSales.length,                  color: '#818cf8',          onClick: () => setOpenOnlineSalesModalOpen(true) },
    { label: 'Open POs',    value: data?.openPOs   ?? 0,                          color: 'var(--sv-amber)',  nav: 'purchase-orders' as ImsView },
    { label: 'Open SOs',    value: data?.openSOs   ?? 0,                          color: '#818cf8',          nav: 'sales-orders' as ImsView },
    { label: 'Low Stock',   value: data?.lowStock  ?? 0,                          color: 'var(--sv-red)',    nav: 'stock' as ImsView },
    { label: 'SOH Value',   display: fmtCompact(data?.stockValue ?? 0),           color: 'var(--sv-mint)',   nav: 'stock' as ImsView },
  ];
  const dashboardSalesRows = (salesData?.channelData as any[]) ?? [];
  const brandChartData = (salesData?.brandData as Array<{ name: string; sales: number }>) ?? [];
  const productInsights = (salesData?.productInsights as {
    top?: DashboardProductInsight[];
    slow?: DashboardProductInsight[];
    byQty?: { top?: DashboardProductInsight[]; slow?: DashboardProductInsight[] };
    byValue?: { top?: DashboardProductInsight[]; slow?: DashboardProductInsight[] };
  } | undefined) ?? {};
  const brandMax = brandChartData.reduce((max, brand) => Math.max(max, brand.sales), 0);
  const periodLabel = salesWindow === 'today' ? 'Today' : salesWindow === 'yesterday' ? 'Yesterday' : salesWindow === '365' ? 'Last year' : `Last ${salesWindow} days`;
  const visibleSalesBarCount = dashboardSalesRows.filter(row => Number(row?.total ?? 0) > 0).length;
  const salesChartColumns = visibleSalesBarCount <= 2 ? 4 : visibleSalesBarCount <= 6 ? 6 : visibleSalesBarCount <= 12 ? 9 : 12;
  const salesSummaryColumns = salesChartColumns === 12 ? 12 : 12 - salesChartColumns;
  const barColor = (i: number, total: number) => {
    const t = total <= 1 ? 0 : i / (total - 1);
    const r = Math.round(67  + t * (224 - 67));
    const g = Math.round(56  + t * (231 - 56));
    const b = Math.round(202 + t * (255 - 202));
    return `rgb(${r},${g},${b})`;
  };
  const printOpenOnlineSales = () => {
    const escapeHtml = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const fmtOrderDate = (v: string) => {
      const s = String(v || '').replace('T', ' ').slice(0, 19);
      if (!s) return '—';
      const d = new Date(s.replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) return s;
      return d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
    };
    const rows = openOnlineSales.map((order: any) => {
      const itemLines = (order.items || []).map((item: any) => {
        const sku = item.sku || item.code || '—';
        const name = item.product_name || item.name || 'Unnamed item';
        const qty = Number(item.qty_ordered || 0);
        return `<li><strong>${escapeHtml(String(sku))}</strong> - ${escapeHtml(String(name))} x ${qty}</li>`;
      }).join('');
      return `
        <tr>
          <td>${escapeHtml(String(order.so_number || '—'))}</td>
          <td>${escapeHtml(fmtOrderDate(order.order_date || ''))}</td>
          <td>${escapeHtml(String(order.status || '—'))}</td>
          <td>${escapeHtml(String(order.customer_name || '—'))}</td>
          <td style="text-align:right; white-space:nowrap;">$${Number(order.total_amount || 0).toFixed(2)}</td>
          <td><ul>${itemLines || '<li>—</li>'}</ul></td>
        </tr>`;
    }).join('');
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Open Online Sales</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #0f172a; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    p { margin: 0 0 16px; color: #475569; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; font-size: 12px; }
    th { background: #f1f5f9; text-align: left; }
    ul { margin: 0; padding-left: 18px; }
    @media print { body { margin: 10mm; } }
  </style>
</head>
<body>
  <h1>Open Online Sales (Draft + Confirmed)</h1>
  <p>Generated ${new Date().toLocaleString('en-AU')} · ${openOnlineSales.length} order(s)</p>
  <table>
    <thead>
      <tr>
        <th>Order</th>
        <th>Date</th>
        <th>Status</th>
        <th>Customer</th>
        <th>Total</th>
        <th>Line items</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6">No open online orders.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
    const w = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=900');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div data-testid="purchase-orders-view">
      {onboarding && !onboarding.complete && (
        <>
          <div style={{ marginBottom: 18, padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', border: '1px solid var(--sv-etch)', borderRadius: 8, background: 'var(--sv-bg-2)' }}>
            <div>
              <div style={{ color: 'var(--sv-text-strong)', fontSize: 13, fontWeight: 750 }}>Business setup</div>
              <div style={{ marginTop: 2, color: 'var(--sv-text-dim)', fontSize: 11 }}>{(onboarding.steps ?? []).filter((step: OnboardingStep) => step.completed).length} of {onboarding.steps?.length ?? 0} steps complete</div>
            </div>
            <button type="button" onClick={() => setOnboardingOpen(true)} style={{ padding: '8px 14px', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontSize: 12, fontWeight: 750, cursor: 'pointer' }}>Continue setup</button>
          </div>
          <OnboardingWizard
            open={onboardingOpen}
            onboarding={onboarding}
            draft={onboardingDraft}
            saving={onboardingSaving}
            xeroAccountingEnabled={xeroAccountingEnabled}
            onClose={() => setOnboardingOpen(false)}
            onFieldChange={setOnboardingField}
            onSaveStep={saveOnboardingStep}
            onCompleteStep={completeOnboardingStep}
            onAction={runOnboardingAction}
          />
        </>
      )}

      {/* Legacy inline onboarding retained temporarily outside the rendered path. */}
      {false && onboarding && !onboarding.complete && (
        <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 12, padding: 24, marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--sv-text-strong)', marginBottom: 2 }}>Onboarding</div>
              <div style={{ fontSize: 13, color: 'var(--sv-text-dim)' }}>Complete the business profile, IMS setup, integrations, imports, and opening stock steps.</div>
            </div>
            <div style={{ minWidth: 180, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>
                <span>Progress</span>
                <span>{onboardingLoading ? 'Loading…' : `${(onboarding.steps ?? []).filter((s: OnboardingStep) => s.completed).length} / ${onboarding.steps?.length ?? 0}`}</span>
              </div>
              <div style={{ height: 6, background: 'var(--sv-bg-2)', borderRadius: 99, overflow: 'hidden', border: '1px solid var(--sv-etch)' }}>
                <div style={{
                  height: '100%',
                  background: 'var(--sv-action)',
                  borderRadius: 99,
                  transition: 'width .3s',
                  width: onboarding.steps?.length
                    ? `${((onboarding.steps.filter((s: OnboardingStep) => s.completed).length / onboarding.steps.length) * 100).toFixed(0)}%`
                    : '0%',
                }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24 }} className="onboarding-grid">
            {/* Left: form fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

              {/* ── Business Identity ── */}
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--sv-text-dim)', marginBottom: 10 }}>Business Identity</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 6 }}>
                <div title="The legal name of your business — appears on PO and tax invoice PDFs.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Business Name</div>
                  <input value={onboardingDraft.business_name ?? ''} onChange={e => setOnboardingField('business_name', e.target.value)}
                    style={{ ...inputStyle, fontSize: 13 }} placeholder="Your company name" />
                </div>
                <div title="Australian Business Number — printed on invoices for GST compliance.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>ABN</div>
                  <input value={onboardingDraft.business_abn ?? ''} onChange={e => setOnboardingField('business_abn', e.target.value)}
                    style={{ ...inputStyle, fontSize: 13 }} placeholder="11 222 333 444" />
                </div>
              </div>
              <div style={{ marginBottom: 20 }} title="The registered business address — appears on PO and tax invoice PDFs.">
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Business Address</div>
                <input value={onboardingDraft.business_address ?? ''} onChange={e => setOnboardingField('business_address', e.target.value)}
                  style={{ ...inputStyle, fontSize: 13 }} placeholder="123 Main St, Sydney NSW 2000" />
              </div>

              {/* ── Operations ── */}
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--sv-text-dim)', marginBottom: 10 }}>Operations</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 6 }}>
                <div title="Turn on when the business sells directly to the public in stores or other staffed locations. Enables POS setup and Location Daybooks.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Business requires POS?</div>
                  <select value={onboardingDraft.business_requires_pos ?? 'yes'} onChange={e => setOnboardingField('business_requires_pos', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </div>
                <div title="Turn on if you have more than one warehouse, store, or fulfilment location. Enables branch transfers and per-location stock.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Multiple locations?</div>
                  <select value={onboardingDraft.use_multiple_locations ?? 'yes'} onChange={e => setOnboardingField('use_multiple_locations', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </div>
                <div title="Zone and bin help locate products within a warehouse (e.g. Zone A, Bin 12). Shown on purchase order PDFs.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Use zones and bins?</div>
                  <select value={onboardingDraft.use_zones_bins ?? 'no'} onChange={e => setOnboardingField('use_zones_bins', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </div>
                <div title="Enables product category and subcategory fields for organising your catalogue.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Use categories?</div>
                  <select value={onboardingDraft.use_categories ?? 'no'} onChange={e => setOnboardingField('use_categories', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </div>
                <div title="Allows purchase orders to be entered in foreign currencies (USD, EUR, etc.) with automatic AUD cost conversion.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Buy in foreign currencies?</div>
                  <select value={onboardingDraft.use_foreign_currencies ?? 'yes'} onChange={e => setOnboardingField('use_foreign_currencies', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </div>
              </div>

              {/* ── Integrations ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 6 }}>
                <div title="Connect Shopify (or another platform) to sync products, inventory levels, and online orders automatically.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Connect an Online Shop?</div>
                  <select value={onboardingDraft.connect_online_shop ?? 'no'} onChange={e => setOnboardingField('connect_online_shop', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </div>
                {onboardingDraft.connect_online_shop === 'yes' && (
                  <div title="The e-commerce platform your online store runs on.">
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Online shop platform</div>
                    <select value={onboardingDraft.online_shop_platform ?? 'shopify'} onChange={e => setOnboardingField('online_shop_platform', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                      <option value="solvantis">Solvantis Online Store</option>
                      <option value="shopify">Shopify</option>
                      <option disabled>WooCommerce — coming soon</option>
                      <option disabled>BigCommerce — coming soon</option>
                      <option disabled>Adobe Commerce — coming soon</option>
                    </select>
                  </div>
                )}
                {xeroAccountingEnabled && <div title="Connect Xero or QuickBooks to automatically post purchase orders, sales invoices, and stocktake journals.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Connect accounting software?</div>
                  <select value={onboardingDraft.connect_accounting_software ?? 'no'} onChange={e => setOnboardingField('connect_accounting_software', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </div>}
                {xeroAccountingEnabled && onboardingDraft.connect_accounting_software === 'yes' && (
                  <div title="The accounting platform you use. Xero is fully supported; QuickBooks is coming soon.">
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Accounting platform</div>
                    <select value={onboardingDraft.accounting_software ?? 'xero'} onChange={e => setOnboardingField('accounting_software', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                      <option value="xero">Xero</option>
                      <option disabled>QuickBooks — coming soon</option>
                    </select>
                  </div>
                )}
              </div>

              {/* divider */}
              <div style={{ height: 1, background: 'var(--sv-etch)', margin: '12px 0 18px' }} />

              {/* ── Tax Settings ── */}
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--sv-text-dim)', marginBottom: 10 }}>Tax Settings</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 6 }}>
                <div title="Whether GST (or your local sales tax) is charged on sales orders and tax invoices.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Charge Sales Tax on Sales Orders?</div>
                  <select value={onboardingDraft.sales_tax_on_sales ?? 'yes'} onChange={e => setOnboardingField('sales_tax_on_sales', e.target.value)} style={{ ...inputStyle, fontSize: 13 }}>
                    <option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </div>
                <div title="The tax code label that appears on PDF invoices, e.g. GST.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Sales Tax Code</div>
                  <input value={onboardingDraft.sales_tax_code ?? ''} onChange={e => setOnboardingField('sales_tax_code', e.target.value)}
                    style={{ ...inputStyle, fontSize: 13 }} placeholder="GST" />
                </div>
                <div title="The sales tax rate as a percentage of the sale price. In Australia this is 10% for GST.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Sales Tax Rate (%)</div>
                  <input type="number" min="0" step="0.01"
                    value={onboardingDraft.sales_tax_rate ? String(Number(onboardingDraft.sales_tax_rate) * 100) : ''}
                    onChange={e => setOnboardingField('sales_tax_rate', e.target.value ? String(Number(e.target.value) / 100) : '')}
                    style={{ ...inputStyle, fontSize: 13 }} placeholder="10" />
                </div>
                <div title="The tax rate applied to purchases (supplier invoices). Usually the same as your sales tax rate.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Purchase Tax Rate (%)</div>
                  <input type="number" min="0" step="0.01"
                    value={onboardingDraft.purchase_tax_rate ? String(Number(onboardingDraft.purchase_tax_rate) * 100) : ''}
                    onChange={e => setOnboardingField('purchase_tax_rate', e.target.value ? String(Number(e.target.value) / 100) : '')}
                    style={{ ...inputStyle, fontSize: 13 }} placeholder="10" />
                </div>
                <div style={{ gridColumn: 'span 2' }} title="The purchase tax code label used on PDF purchase orders, e.g. GST on Purchases.">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)', marginBottom: 4 }}>Purchase Tax Code</div>
                  <input value={onboardingDraft.purchase_tax_code ?? ''} onChange={e => setOnboardingField('purchase_tax_code', e.target.value)}
                    style={{ ...inputStyle, fontSize: 13 }} placeholder="GST on Purchases" />
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <button onClick={() => saveOnboardingStep('business_profile', onboardingDraft)} disabled={onboardingSaving}
                  style={{ padding: '8px 20px', background: 'var(--sv-action)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 13, cursor: onboardingSaving ? 'wait' : 'pointer', opacity: onboardingSaving ? .6 : 1 }}>
                  {onboardingSaving ? 'Saving…' : 'Save details'}
                </button>
              </div>
            </div>

            {/* Right: step checklist */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(onboarding.steps ?? []).map((step: OnboardingStep, index: number) => {
                const action = step.id === 'accounting' && !xeroAccountingEnabled
                  ? undefined
                  : IMS_ONBOARDING_ACTIONS[step.id];
                const handleAction = action
                  ? () => action.type === 'nav'
                    ? onNav((action as { type: 'nav'; view: ImsView; label: string }).view)
                    : onOpenSettings?.((action as { type: 'settings'; section: string; label: string }).section)
                  : undefined;
                return (
                  <div key={step.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    borderRadius: 8, border: '1px solid var(--sv-etch)',
                    background: step.completed ? 'rgba(16,185,129,.06)' : 'var(--sv-bg-2)',
                  }}>
                    <button onClick={() => completeOnboardingStep(step.id)} disabled={step.completed || onboardingSaving}
                      style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: step.completed ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12,
                        background: step.completed ? 'var(--sv-mint, #10b981)' : 'rgba(37,99,235,.15)',
                        color: step.completed ? '#fff' : 'var(--sv-action)' }}>
                      {step.completed ? '✓' : index + 1}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: step.completed ? 'var(--sv-text-dim)' : 'var(--sv-text-strong)', textDecoration: step.completed ? 'line-through' : 'none', opacity: step.completed ? .6 : 1 }}>{step.title}</div>
                      {action && !step.completed && (
                        <button onClick={handleAction} style={{ fontSize: 11, fontWeight: 600, color: 'var(--sv-action)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 1 }}>
                          {action.label} →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--sv-text-strong)', marginBottom: 24 }}>Dashboard</h1>
      {loading ? <Spinner /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 32 }}>
            {stats.map(s => (
              <button key={s.label} onClick={() => { if (s.onClick) s.onClick(); else if (s.nav) onNav(s.nav); }}
                style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '18px 16px', textAlign: 'left', cursor: 'pointer', transition: 'border-color .15s' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = s.color)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--sv-etch)')}>
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.display ?? s.value}</div>
                <div style={{ fontSize: 13, color: 'var(--sv-text-dim)', marginTop: 4 }}>{s.label}</div>
              </button>
            ))}
          </div>

          {/* POS Registers */}
          <div style={{ marginTop: 24, background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sv-etch)', background: 'color-mix(in srgb, var(--sv-bg-1) 42%, var(--sv-bg-2))', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: (data?.openRegisters ?? []).length > 0 ? 'var(--sv-mint)' : 'var(--sv-text-dim)' }} />
              <DashboardPanelHeading eyebrow="Store operations" title="POS Registers" titleColor="var(--sv-text-main)" />
                          <style>{`@media (max-width: 900px) { .ims-sales-chart-panel, .ims-sales-summary-panel { grid-column: 1 / -1 !important; } .ims-dashboard-insights-grid { grid-template-columns: 1fr !important; } }`}</style>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, textAlign: 'right' }}>
                {(data?.openRegisters ?? []).length > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--sv-mint)' }}>{data.openRegisters.length} open</span>
                )}
                {(data?.posRegisters ?? []).length > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--sv-text-dim)' }}>· {(data.posRegisters as any[]).filter((r: any) => r.status === 'closed').length} closed today</span>
                )}
              </div>
            </div>
            {!(data?.posRegisters ?? []).length ? (
              <div style={{ padding: 20, color: 'var(--sv-text-dim)', fontSize: 13 }}>No register sessions today.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead style={{ background: 'color-mix(in srgb, var(--sv-bg-1) 68%, var(--sv-bg-2))' }}>
                    <tr>
                      {['Register', 'Location', 'Status', 'Opened', 'Opened By', 'Float', 'Closed', 'Closed By', 'Close Totals'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody style={{ background: 'var(--sv-bg-2)' }}>
                    {(data.posRegisters as any[]).map((r: any, i: number) => {
                      const fmtDt = (v: string | null) => {
                        if (!v) return '—';
                        // Stored as AEST by localNow() — display directly, no Date conversion
                        const [datePart = '', timePart = ''] = v.replace('T', ' ').split(' ');
                        const [y = '', m = '', d = ''] = datePart.split('-');
                        const [h = '0', min = '00'] = timePart.split(':');
                        const hour = parseInt(h, 10);
                        return `${d}/${m}/${y}, ${hour % 12 || 12}:${min} ${hour >= 12 ? 'pm' : 'am'}`;
                      };
                      const isOpen = r.status === 'open';
                      const totals: { payment_method: string; counted_amount: string }[] = r.close_totals ?? [];
                      return (
                        <tr key={i} style={{ borderTop: '1px solid var(--sv-etch)', opacity: isOpen ? 1 : 0.8 }}>
                          <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--sv-text-main)', fontWeight: 600 }}>{r.register_name}</td>
                          <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--sv-text-main)' }}>{r.location_name}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                              background: isOpen ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)',
                              color: isOpen ? 'var(--sv-mint)' : 'var(--sv-red)' }}>
                              {isOpen ? '● Open' : 'Closed'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{fmtDt(r.opened_at)}</td>
                          <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--sv-text-main)' }}>{r.opened_by || '—'}</td>
                          <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--sv-text-main)', whiteSpace: 'nowrap' }}>{r.opening_float != null ? fmtCurrency(Number(r.opening_float)) : '—'}</td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--sv-text-dim)', whiteSpace: 'nowrap' }}>{isOpen ? '—' : fmtDt(r.closed_at)}</td>
                          <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--sv-text-main)' }}>{isOpen ? '—' : (r.closed_by || '—')}</td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--sv-text-main)' }}>
                            {totals.length === 0 ? <span style={{ color: 'var(--sv-text-dim)' }}>—</span> : (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                                {totals.map(t => (
                                  <span key={t.payment_method} style={{ whiteSpace: 'nowrap' }}>
                                    <span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>{t.payment_method}: </span>
                                    <span style={{ fontWeight: 600 }}>{fmtCurrency(Number(t.counted_amount))}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start' }}>
            <style>{`@media (max-width: 900px) { .ims-sales-chart-panel, .ims-sales-summary-panel { grid-column: 1 / -1 !important; } }`}</style>
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginBottom: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase' }}>Reporting period</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
                {([
                  ['today', 'Today'],
                  ['yesterday', 'Yesterday'],
                  ['30', '30d'],
                  ['120', '120d'],
                  ['365', '1yr'],
                ] as const).map(([value, label]) => (
                  <button key={value} onClick={() => setSalesWindow(value)}
                    style={{ padding: '6px 13px', fontSize: 12, fontWeight: 600, borderRadius: 6,
                      border: `1px solid ${salesWindow === value ? 'var(--sv-action)' : 'var(--sv-etch)'}`,
                      background: salesWindow === value ? 'var(--sv-action)' : 'var(--sv-bg-2)',
                      color: salesWindow === value ? '#fff' : 'var(--sv-text-main)', cursor: 'pointer', transition: 'all .15s' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 18, alignItems: 'start' }}>
              {/* ── Sales by Channel ── */}
              <div className="ims-sales-chart-panel" style={{ minWidth: 0, gridColumn: `span ${salesChartColumns}` }}>
            {salesLoading ? (
              <div style={{ height: 450, padding: '18px 20px', boxSizing: 'border-box', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10 }}>
                <DashboardPanelHeading eyebrow="Sales mix" title={`Sales and Gross Profit by Channel - ${periodLabel}`} />
                <div style={{ height: 'calc(100% - 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
              </div>
            ) : !(salesData?.channelData?.length) ? (
              <div style={{ height: 450, padding: '18px 20px', boxSizing: 'border-box', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10 }}>
                <DashboardPanelHeading eyebrow="Sales mix" title={`Sales and Gross Profit by Channel - ${periodLabel}`} />
                <div style={{ height: 'calc(100% - 20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>No sales in this period.</div>
              </div>
            ) : (() => {
              const CD = salesData.channelData as any[];
              const CH_COLOR: Record<string, string> = { pos: '#5ab5bc', wholesale: '#f59e0b', online: '#818cf8' };
              const CH_GP_LINE: Record<string, string> = { pos: '#3f8e94', wholesale: '#b87707', online: '#5f68c9' };
              const CH_LABEL: Record<string, string> = { pos: 'POS', wholesale: 'Wholesale', online: 'Online' };
              const activeChannels = (['pos','wholesale','online'] as const).filter(ch => CD.some((d: any) => d.channel === ch));
              const locations = [...new Set(CD.map((d: any) => d.location_name as string))];
              const getRow = (ch: string, loc: string) => CD.find((d: any) => d.channel === ch && d.location_name === loc);
              const getVal = (ch: string, loc: string) => Number(getRow(ch, loc)?.total ?? 0);
              const getOrd = (ch: string, loc: string) => Number(getRow(ch, loc)?.order_count ?? 0);

              const rawMax = Math.max(...CD.map((d: any) => Number(d.total)));
              const niceMax = (v: number) => { if (v <= 0) return 1000; const m = Math.pow(10, Math.floor(Math.log10(v))); for (const x of [1,2,5,10]) { if (m*x >= v) return m*x; } return m*10; };
              const yMax = niceMax(rawMax);
              const yTicks = [0,1,2,3,4].map(i => Math.round((i/4) * yMax));

              const VW=visibleSalesBarCount <= 2 ? 420 : visibleSalesBarCount <= 6 ? 600 : visibleSalesBarCount <= 12 ? 840 : 1100;
              const VH=360, PL=72, PR=16, PT=46, PB=56;
              const plotW=VW-PL-PR, plotH=VH-PT-PB;
              const nLoc=locations.length, nCh=activeChannels.length;
              const groupW=plotW/nLoc;
              const slotW=Math.min(78, Math.max(18, (groupW*0.92)/nCh));
              const barW=Math.max(14, slotW-Math.max(2, slotW*0.06));
              const getLocChans=(loc:string) => activeChannels.filter(ch => getVal(ch,loc) > 0);
              const xBarLocal=(li:number, localCi:number, nLocalCh:number) => {
                const offset=(groupW - slotW*nLocalCh)/2;
                return PL + li*groupW + offset + localCi*slotW + 1.5;
              };
              const yVal=(v:number) => PT + plotH - (v/yMax)*plotH;
              const hVal=(v:number) => (v/yMax)*plotH;
              const fmtY=(v:number) => {
                if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
                if (v >= 1000) {
                  const k = v / 1000;
                  return `$${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
                }
                return `$${Math.round(v)}`;
              };
              const trunc=(s:string,n=17) => s.length>n ? s.slice(0,n)+'…' : s;

              return (
                <div ref={channelChartRef} style={{ position: 'relative', height: 450, boxSizing: 'border-box', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '14px 16px 8px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
                    <DashboardPanelHeading eyebrow="Sales mix" title={`Sales and Gross Profit by Channel - ${periodLabel}`} />
                    <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                    {activeChannels.map(ch => (
                      <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--sv-text-dim)' }}>
                        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: CH_COLOR[ch] }} />
                        {CH_LABEL[ch]}
                      </div>
                    ))}
                    </div>
                  </div>
                  <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" style={{ width: 'max(75%, min(100%, 1100px))', maxWidth: '100%', maxHeight: '100%', display: 'block', overflow: 'visible' }}>
                    {yTicks.map(tick => {
                      const y = yVal(tick);
                      return (
                        <g key={tick}>
                          <line x1={PL} y1={y} x2={VW-PR} y2={y} stroke="currentColor" strokeOpacity="0.1" strokeDasharray={tick===0?undefined:'4,3'} />
                          <text x={PL-7} y={y+4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.66" fontWeight="500">{fmtY(tick)}</text>
                        </g>
                      );
                    })}
                    <line x1={PL} y1={PT+plotH} x2={VW-PR} y2={PT+plotH} stroke="currentColor" strokeOpacity="0.15" />
                    {locations.map((loc, li) => {
                      const locChans = getLocChans(loc);
                      return (
                        <g key={loc}>
                          {locChans.map((ch, localCi) => {
                            const v = getVal(ch, loc);
                            const row = getRow(ch, loc);
                            const tax = Number(row?.tax ?? 0);
                            const cogs = Number(row?.cogs ?? 0);
                            const grossProfit = Number(row?.gross_profit ?? 0);
                            const x=xBarLocal(li,localCi,locChans.length), y=yVal(v), h=hVal(v);
                            return (
                              <g key={ch}>
                                <rect
                                  x={x}
                                  y={y}
                                  width={barW}
                                  height={h}
                                  fill={CH_COLOR[ch]}
                                  rx="3"
                                  opacity="0.85"
                                  onMouseMove={(e) => {
                                    const box = channelChartRef.current?.getBoundingClientRect();
                                    if (!box) return;
                                    setChannelHover({
                                      x: e.clientX - box.left,
                                      y: e.clientY - box.top,
                                      channel: CH_LABEL[ch],
                                      location: loc,
                                      sales: v,
                                      tax,
                                      cogs,
                                      grossProfit,
                                      orders: getOrd(ch, loc),
                                    });
                                  }}
                                  onMouseLeave={() => setChannelHover(null)}
                                />
                                {v > 0 && (
                                  <>
                                    <text
                                      x={x + barW / 2}
                                      y={y - 25}
                                      textAnchor="middle"
                                      fontSize="10"
                                      fill="currentColor"
                                      fillOpacity="0.78"
                                      fontWeight="650"
                                      pointerEvents="none"
                                    >
                                      {fmtCurrency(v)}
                                    </text>
                                    <line
                                      x1={x + 2}
                                      y1={y - 19}
                                      x2={x + barW - 2}
                                      y2={y - 19}
                                      stroke={CH_GP_LINE[ch] ?? 'rgba(15,23,42,.8)'}
                                      strokeWidth="1"
                                      strokeOpacity="0.55"
                                      pointerEvents="none"
                                    />
                                    <text
                                      x={x + barW / 2}
                                      y={y - 8}
                                      textAnchor="middle"
                                      fontSize="9"
                                      fill={CH_GP_LINE[ch] ?? 'rgba(15,23,42,.8)'}
                                      fillOpacity="1"
                                      fontWeight="600"
                                      pointerEvents="none"
                                    >
                                      GP {fmtCurrency(grossProfit)}
                                    </text>
                                  </>
                                )}
                              </g>
                            );
                          })}
                          <text x={PL+li*groupW+groupW/2} y={PT+plotH+20} textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.75" fontWeight="600">{trunc(loc)}</text>
                        </g>
                      );
                    })}
                  </svg>
                  </div>
                  {channelHover && (() => {
                    const hostW = channelChartRef.current?.clientWidth ?? 760;
                    const left = Math.max(130, Math.min(channelHover.x, hostW - 130));
                    const top = Math.min(channelHover.y + 18, 400);
                    return (
                      <div
                        style={{
                          position: 'absolute',
                          left,
                          top,
                          transform: 'translate(-50%, 0)',
                          pointerEvents: 'none',
                          background: 'rgba(15,23,42,.96)',
                          color: '#fff',
                          borderRadius: 8,
                          padding: '8px 10px',
                          minWidth: 240,
                          boxShadow: '0 8px 24px rgba(0,0,0,.25)',
                          fontSize: 12,
                          lineHeight: 1.35,
                          zIndex: 3,
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{channelHover.channel} - {channelHover.location}</div>
                        <div>Sales: {fmtCurrency(channelHover.sales)}</div>
                        <div>Tax: {fmtCurrency(channelHover.tax)}</div>
                        <div>COGS: {fmtCurrency(channelHover.cogs)}</div>
                        <div style={{ fontWeight: 700, marginTop: 2 }}>Gross Profit: {fmtCurrency(channelHover.grossProfit)}</div>
                        <div style={{ opacity: .85, marginTop: 2 }}>GP = Sales - Tax - COGS - {channelHover.orders} orders</div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

              </div>

              <div className="ims-sales-summary-panel" style={{ minWidth: 0, gridColumn: `span ${salesSummaryColumns}` }}>
                <TotalSalesProfitCircle rows={dashboardSalesRows} itemCount={Number(salesData?.summary?.itemCount ?? 0)} periodLabel={periodLabel} loading={salesLoading} />
              </div>
            </div>

            {/* Top 10 Brands */}
            <div className="ims-dashboard-insights-grid" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(300px, .8fr) minmax(520px, 1.2fr)', gap: 18, alignItems: 'stretch' }}>
            {/* Top 10 Brands */}
            <div style={{ minWidth: 0, height: '100%', boxSizing: 'border-box', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, padding: '13px 16px' }}>
              <DashboardPanelHeading eyebrow="Brand performance" title={`Top 10 Brands - ${periodLabel}`} style={{ marginBottom: 14 }} />
              {salesLoading && <p style={{ fontSize: 13, color: 'var(--sv-text-dim)', margin: 0, padding: '10px 0', textAlign: 'center' }}>Loading…</p>}
              {!salesLoading && brandChartData.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--sv-text-dim)', margin: 0, padding: '10px 0', textAlign: 'center' }}>No brand sales in this period.</p>
              )}
              {!salesLoading && brandChartData.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {brandChartData.map((b, i) => {
                    const pct = brandMax > 0 ? (b.sales / brandMax) * 100 : 0;
                    return (
                      <div key={b.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-main)', maxWidth: '62%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                          <span style={{ fontSize: 12, color: 'var(--sv-text-dim)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            ${b.sales.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <div style={{ height: 12, borderRadius: 999, background: 'var(--sv-bg-1)', overflow: 'hidden', border: '1px solid var(--sv-etch)' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              borderRadius: 999,
                              backgroundColor: barColor(i, brandChartData.length),
                              transition: 'width .5s ease',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <DashboardProductInsights
              top={productInsights.byQty?.top ?? productInsights.top ?? []}
              slow={productInsights.byQty?.slow ?? productInsights.slow ?? []}
              valueTop={productInsights.byValue?.top ?? []}
              valueSlow={productInsights.byValue?.slow ?? []}
              periodLabel={periodLabel}
              loading={salesLoading}
            />
            </div>
            <DashboardSalesComparison />
          </div>
        </>
      )}

      {openOnlineSalesModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div style={{ width: 'min(1200px, 96vw)', maxHeight: '92vh', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--sv-etch)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Open Online Sales</div>
              <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Draft + Confirmed</div>
              <span style={{ flex: 1 }} />
              <button onClick={printOpenOnlineSales} style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer' }}>Print list</button>
              <button onClick={() => setOpenOnlineSalesModalOpen(false)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer' }}>Close</button>
            </div>
            <div style={{ padding: 14, overflow: 'auto' }}>
              {openOnlineSalesLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--sv-text-dim)' }}>Loading open online sales…</div>
              ) : openOnlineSales.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--sv-text-dim)' }}>No open online sales.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {openOnlineSales.map((order: any) => (
                    <div key={order.id} style={{ border: '1px solid var(--sv-etch)', borderRadius: 10, background: 'var(--sv-bg-1)', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderBottom: '1px solid var(--sv-etch)' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{order.so_number}</span>
                        <span style={{ fontSize: 11, color: order.status === 'draft' ? '#9ca3af' : '#f59e0b', border: '1px solid var(--sv-etch)', borderRadius: 99, padding: '1px 8px' }}>{String(order.status || '').toUpperCase()}</span>
                        <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{new Date(String(order.order_date || '').replace(' ', 'T')).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        <span style={{ fontSize: 12, color: 'var(--sv-text-main)' }}>{order.customer_name || '—'}</span>
                        <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{order.location_name || '—'}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--sv-text-strong)' }}>{fmtCurrency(Number(order.total_amount || 0))}</span>
                        <button
                          onClick={() => {
                            setOpenOnlineSalesModalOpen(false);
                            if (onOpenSalesOrder) onOpenSalesOrder(Number(order.id));
                            else onNav('sales-orders');
                          }}
                          style={{ fontSize: 12, fontWeight: 600, padding: '5px 9px', borderRadius: 6, border: '1px solid var(--sv-action)', color: 'var(--sv-action)', background: 'transparent', cursor: 'pointer' }}
                        >
                          View Order
                        </button>
                      </div>
                      <div style={{ padding: '8px 12px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left', padding: '5px 4px', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 600 }}>SKU</th>
                              <th style={{ textAlign: 'left', padding: '5px 4px', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 600 }}>Product</th>
                              <th style={{ textAlign: 'right', padding: '5px 4px', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 600 }}>Qty</th>
                              <th style={{ textAlign: 'right', padding: '5px 4px', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 600 }}>Unit</th>
                              <th style={{ textAlign: 'right', padding: '5px 4px', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 600 }}>Line total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(order.items || []).map((item: any) => (
                              <tr key={item.id} style={{ borderTop: '1px solid var(--sv-etch)' }}>
                                <td style={{ padding: '6px 4px', fontSize: 12, color: 'var(--sv-text-dim)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{item.sku || item.code || '—'}</td>
                                <td style={{ padding: '6px 4px', fontSize: 12, color: 'var(--sv-text-main)' }}>{item.product_name || item.name || '—'}</td>
                                <td style={{ padding: '6px 4px', fontSize: 12, color: 'var(--sv-text-main)', textAlign: 'right' }}>{Number(item.qty_ordered || 0)}</td>
                                <td style={{ padding: '6px 4px', fontSize: 12, color: 'var(--sv-text-main)', textAlign: 'right' }}>{fmtCurrency(Number(item.unit_price || 0))}</td>
                                <td style={{ padding: '6px 4px', fontSize: 12, color: 'var(--sv-text-main)', textAlign: 'right' }}>{fmtCurrency(Number(item.line_total || 0))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecentTable({ title, rows, columns }: { title: string; rows: any[]; columns: { key: string; label: string; render?: (v: any) => React.ReactNode }[] }) {
  return (
    <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--sv-etch)', fontSize: 14, fontWeight: 600, color: 'var(--sv-text-strong)' }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ padding: 20, color: 'var(--sv-text-dim)', fontSize: 13 }}>No records yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{columns.map(c => <th key={c.key} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: .8 }}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--sv-etch)' }}>
                {columns.map(c => (
                  <td key={c.key} style={{ padding: '8px 12px', fontSize: 13, color: 'var(--sv-text-main)' }}>
                    {c.render ? c.render(row[c.key]) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contacts View
// ─────────────────────────────────────────────────────────────────────────────

const BLANK_CONTACT = {
  type: 'supplier' as string,
  name: '', first_name: '', last_name: '',
  company: '', customer_code: '', customer_group: '',
  lead_temperature: 'warm',
  email: '', phone: '', mobile: '',
  address: '', address2: '', suburb: '',
  city: '', state: '', postcode: '', country: 'Australia',
  notes: '', is_active: 1,
  store_credit: 0, on_account_limit: '' as string | number,
  date_of_birth: '', gender: '',
  promo_email: 0, promo_sms: 0,
  price_tier: 'retail', order_frequency_days: 45,
  wholesale_allowed_brands_json: null as string[] | string | null,
  customer_early_payment_discount_rule_id: '' as string | number,
  supplier_early_payment_discount_rule_id: '' as string | number,
  charges_tax: 1, prices_include_tax: 0, tax_rate: '', website_url: '',
};
const CONTACT_EXPORT_HEADERS = [
  'id', 'type', 'lead_temperature', 'name', 'first_name', 'last_name', 'company', 'customer_code', 'customer_group', 'shopify_customer_id',
  'email', 'phone', 'mobile', 'address', 'address2', 'suburb', 'city', 'state', 'postcode', 'country', 'notes',
  'is_active', 'store_credit', 'on_account_limit', 'date_of_birth', 'gender', 'promo_email', 'promo_sms',
  'price_tier', 'lead_time_days', 'order_frequency_days', 'charges_tax', 'prices_include_tax', 'tax_rate',
  'website_url', 'cin7_supplier_id', 'cin7_contact_id',
] as const;
type ContactExportHeader = typeof CONTACT_EXPORT_HEADERS[number];

const CONTACT_FIELD_GUIDE: Array<{ key: ContactExportHeader; label: string; description: string; example: string }> = [
  { key: 'id', label: 'ID', description: 'Leave blank for new rows. When present, the importer updates the matching contact.', example: '1234' },
  { key: 'type', label: 'Type', description: 'Contact role. Use supplier, b2b_customer, retail_customer, lead, or both.', example: 'retail_customer' },
  { key: 'lead_temperature', label: 'Lead Temperature', description: 'Lead qualification. Use cold, warm, or hot; leave blank for non-leads.', example: 'warm' },
  { key: 'name', label: 'Name', description: 'Display name shown in IMS.', example: 'Jane Smith' },
  { key: 'first_name', label: 'First Name', description: 'First name used for greetings and Shopify sync.', example: 'Jane' },
  { key: 'last_name', label: 'Last Name', description: 'Surname used for greetings and Shopify sync.', example: 'Smith' },
  { key: 'company', label: 'Company', description: 'Business or trading name attached to the contact.', example: 'Smith Retail Pty Ltd' },
  { key: 'customer_code', label: 'Customer Code', description: 'External customer code from Sage / Lightspeed / another system.', example: 'CUST-10023' },
  { key: 'customer_group', label: 'Customer Group', description: 'Optional grouping label for customers.', example: 'VIP' },
  { key: 'shopify_customer_id', label: 'Shopify Customer ID', description: 'Numeric Shopify customer link used for sync and gift card matching.', example: '9876543210' },
  { key: 'email', label: 'Email', description: 'Primary email address used for contact and Shopify matching.', example: 'jane@example.com' },
  { key: 'phone', label: 'Phone', description: 'Main landline or alternate phone number.', example: '03 9000 0000' },
  { key: 'mobile', label: 'Mobile', description: 'Mobile number. Shopify sync prefers this when present.', example: '0400 123 456' },
  { key: 'address', label: 'Address', description: 'Street address line 1.', example: '12 Sample Street' },
  { key: 'address2', label: 'Address 2', description: 'Apartment, unit, suite, or second address line.', example: 'Unit 4' },
  { key: 'suburb', label: 'Suburb', description: 'Suburb or district.', example: 'Richmond' },
  { key: 'city', label: 'City', description: 'City / town / locality.', example: 'Melbourne' },
  { key: 'state', label: 'State', description: 'State or province.', example: 'VIC' },
  { key: 'postcode', label: 'Postcode', description: 'Postal or ZIP code.', example: '3121' },
  { key: 'country', label: 'Country', description: 'Country name. Defaults to Australia in the UI.', example: 'Australia' },
  { key: 'notes', label: 'Notes', description: 'Internal notes for staff only.', example: 'Prefers email after 3pm' },
  { key: 'is_active', label: 'Is Active', description: 'Use 1/0, yes/no, or true/false to control active status.', example: '1' },
  { key: 'store_credit', label: 'Store Credit', description: 'Read-only balance created by completed IMS or POS customer credit notes.', example: '25.00' },
  { key: 'on_account_limit', label: 'On Account Limit', description: 'Maximum credit account limit. Leave blank for no limit.', example: '500.00' },
  { key: 'date_of_birth', label: 'Date of Birth', description: 'Retail customer date of birth in YYYY-MM-DD format.', example: '1988-07-14' },
  { key: 'gender', label: 'Gender', description: 'Optional gender flag used by the retail contact form.', example: 'F' },
  { key: 'promo_email', label: 'Promo Email', description: 'Marketing email opt-in. Use 1/0 or yes/no.', example: '1' },
  { key: 'promo_sms', label: 'Promo SMS', description: 'Marketing SMS opt-in. Use 1/0 or yes/no.', example: '0' },
  { key: 'price_tier', label: 'Price Tier', description: 'Retail or wholesale pricing tier for the contact.', example: 'retail' },
  { key: 'lead_time_days', label: 'Lead Time Days', description: 'Supplier lead time in days.', example: '14' },
  { key: 'order_frequency_days', label: 'Order Frequency Days', description: 'Supplier reorder cadence in days.', example: '45' },
  { key: 'charges_tax', label: 'Charges Tax', description: 'Whether this supplier charges tax. Use 1/0 or yes/no.', example: '1' },
  { key: 'prices_include_tax', label: 'Prices Include Tax', description: 'Whether supplier prices already include tax. Use 1/0 or yes/no.', example: '0' },
  { key: 'tax_rate', label: 'Tax Rate', description: 'Tax override as a decimal percentage, e.g. 0.10 for 10%.', example: '0.10' },
  { key: 'website_url', label: 'Website URL', description: 'Supplier website or contact site URL.', example: 'https://example.com' },
  { key: 'cin7_supplier_id', label: 'Cin7 Supplier ID', description: 'Optional Cin7 supplier linkage ID.', example: '44882' },
  { key: 'cin7_contact_id', label: 'Cin7 Contact ID', description: 'Optional Cin7 contact linkage ID.', example: '55219' },
];

type ParsedContactImportRow = { raw: Record<string, string>; action: 'new_contact' | 'update' | 'error'; errorMsg?: string; existingId?: number; changedFields?: string[] };
const normalizeContactHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '_');
const contactBool = (value: string | undefined) => {
  if (value == null || value === '') return undefined;
  const v = value.trim().toLowerCase();
  if (['1', 'yes', 'y', 'true', 'on', 'active', 'enabled'].includes(v)) return 1;
  if (['0', 'no', 'n', 'false', 'off', 'inactive', 'disabled'].includes(v)) return 0;
  return undefined;
};
const contactNum = (value: string | undefined) => {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};
const CONTACT_TYPE_LABEL: Record<string, string> = {
  supplier:        'Supplier',
  b2b_customer:    'B2B Customer',
  retail_customer: 'Retail Customer',
  lead:            'Lead',
  both:            'Supplier & B2B Customer',
};

function ContactsView({ mode = 'admin', isAdvisor = false, onOpenProfile }: { mode?: 'admin' | 'crm'; isAdvisor?: boolean; onOpenProfile: (id: number) => void }) {
  const isCrmMode = mode === 'crm';
  const { settings: contactSettings } = useImsSettings();
  const DEFAULT_STATUS_FILTER = '1';
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [crmSection, setCrmSection] = useState<'contacts' | 'tasks' | 'segments' | 'pipeline' | 'data quality' | 'analytics'>('contacts');
  const [crmWorkspaceLoading, setCrmWorkspaceLoading] = useState(true);
  const [crmWorkspaceError, setCrmWorkspaceError] = useState('');
  const [crmWorkspace, setCrmWorkspace] = useState<{
    tasks: ContactCrmWorkspaceTask[];
    taskTruncated: boolean;
    contactMeta: Record<number, { openTaskCount: number; overdueTaskCount: number; lastInteractionAt: string | null; tags: Array<{ id: number; name: string; color?: string | null }> }>;
    tags: Array<{ id: number; name: string; color?: string | null }>;
    assignees: Array<{ id: number; name: string }>;
  }>({ tasks: [], taskTruncated: false, contactMeta: {}, tags: [], assignees: [] });
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState(isCrmMode ? 'crm_all' : 'supplier');
  const [priceTierFilter, setPriceTierFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState(DEFAULT_STATUS_FILTER);
  const [storeCreditFilter, setStoreCreditFilter] = useState('all');
  const [promoEmailFilter, setPromoEmailFilter] = useState('all');
  const [promoSmsFilter, setPromoSmsFilter] = useState('all');
  const [crmTagFilter, setCrmTagFilter] = useState('all');
  const [crmFollowUpFilter, setCrmFollowUpFilter] = useState('all');
  const [crmLastTouchFilter, setCrmLastTouchFilter] = useState('all');
  const [crmLeadTemperatureFilter, setCrmLeadTemperatureFilter] = useState('all');
  const [contactsFiltersOpen, setContactsFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; edit: any | null }>({ open: false, edit: null });
  const [form, setForm] = useState({ ...BLANK_CONTACT });
  const [displayNameEdited, setDisplayNameEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<number>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportingContacts, setExportingContacts] = useState(false);
  const [wholesaleBrands, setWholesaleBrands] = useState<string[]>([]);
  const [earlyPaymentRules, setEarlyPaymentRules] = useState<any[]>([]);

  useEffect(() => {
    if (contactSettings.sells_wholesale === 'no') return;
    fetch('/api/ims/wholesale-brands').then(response => response.json()).then(payload => {
      if (payload.success && Array.isArray(payload.data)) setWholesaleBrands(payload.data);
    }).catch(() => {});
  }, [contactSettings.sells_wholesale]);

  useEffect(() => {
    fetch('/api/ims/early-payment-discount-rules').then(response => response.json()).then(payload => {
      if (payload.success && Array.isArray(payload.data)) setEarlyPaymentRules(payload.data);
    }).catch(() => {});
  }, []);

  const flashSyncMsg = useCallback((message: string) => {
    setSyncMsg(message);
    window.setTimeout(() => setSyncMsg(''), 4500);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const normalize = (rows: any[]) => rows.slice().sort((a, b) => {
      const weight = (c: any) => (c.type === 'supplier' || c.type === 'both' ? 0 : c.type === 'b2b_customer' ? 1 : c.type === 'retail_customer' ? 2 : 3);
      const diff = weight(a) - weight(b);
      return diff !== 0 ? diff : String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
    const mergeById = (base: any[], extra: any[]) => {
      const map = new Map<number, any>();
      for (const row of [...base, ...extra]) map.set(Number(row.id), row);
      return normalize([...map.values()]);
    };
    const fetchContacts = async (params: string) => {
      const res = await fetch(`/api/ims/contacts?${params}`);
      const d = await res.json();
      return d.success ? d.data ?? [] : [];
    };
    (async () => {
      try {
        if (isCrmMode) {
          const [b2bRows, retailRows, leadRows] = await Promise.all([
            fetchContacts('type=b2b_customer'),
            fetchContacts('type=retail_customer'),
            fetchContacts('type=lead'),
          ]);
          setContacts(mergeById(b2bRows, [...retailRows, ...leadRows]));
          setLoading(false);
          return;
        }

        const [supplierRows, b2bRows] = await Promise.all([
          fetchContacts('type=supplier'),
          fetchContacts('type=b2b_customer'),
        ]);
        const initial = mergeById(supplierRows, b2bRows);
        setContacts(initial);
        setLoading(false);

        void (async () => {
          try {
            const [retailRows, leadRows] = await Promise.all([
              fetchContacts('type=retail_customer'),
              fetchContacts('type=lead'),
            ]);
            setContacts(prev => mergeById(prev, [...retailRows, ...leadRows]));
          } catch {
            // Background fill is best-effort.
          }
        })();
      } catch (e) {
        setContacts([]);
            {xeroAccountingEnabled && <DetailSectionDivider label="Xero" marginTop={12} summary="Xero integration enabled" />}
      }
    })();
  }, [isCrmMode]);

  useEffect(() => { load(); }, [load]);

  const loadCrmWorkspace = useCallback(async () => {
    setCrmWorkspaceLoading(true);
    setCrmWorkspaceError('');
    try {
      const [workspaceResponse, assigneeResponse] = await Promise.all([
        fetch('/api/ims/contacts/crm-workspace'),
        fetch('/api/ims/contacts/assignees'),
      ]);
      const [workspacePayload, assigneePayload] = await Promise.all([
        workspaceResponse.json().catch(() => ({})),
        assigneeResponse.json().catch(() => ({})),
      ]);
      if (!workspaceResponse.ok || workspacePayload.success === false) {
        throw new Error(workspacePayload.error || 'CRM workspace could not be loaded.');
      }
      setCrmWorkspace({
        tasks: Array.isArray(workspacePayload.data?.tasks) ? workspacePayload.data.tasks : [],
        taskTruncated: Boolean(workspacePayload.data?.taskTruncated),
        contactMeta: workspacePayload.data?.contactMeta ?? {},
        tags: Array.isArray(workspacePayload.data?.tags) ? workspacePayload.data.tags : [],
        assignees: assigneeResponse.ok && assigneePayload.success && Array.isArray(assigneePayload.data) ? assigneePayload.data : [],
      });
    } catch (cause) {
      setCrmWorkspaceError(cause instanceof Error ? cause.message : 'CRM workspace could not be loaded.');
    } finally {
      setCrmWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isCrmMode) void loadCrmWorkspace();
  }, [isCrmMode, loadCrmWorkspace]);

  const openNew = () => { setDisplayNameEdited(false); setForm({ ...BLANK_CONTACT }); setModal({ open: true, edit: null }); };
  const openEdit = (c: any) => { setDisplayNameEdited(true); setForm({ ...BLANK_CONTACT, ...c }); setModal({ open: true, edit: c }); };
  const closeModal = () => setModal({ open: false, edit: null });

  const runInBatches = async <T,>(items: T[], batchSize: number, worker: (item: T) => Promise<void>) => {
    for (let i = 0; i < items.length; i += batchSize) {
      await Promise.all(items.slice(i, i + batchSize).map(worker));
    }
  };

  const downloadContactsCsv = async () => {
    setExportingContacts(true);
    try {
      const esc = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const lines = [CONTACT_EXPORT_HEADERS.map(esc).join(',')];
      for (const c of contacts) {
        lines.push(CONTACT_EXPORT_HEADERS.map(h => esc((c as Record<string, any>)[h])).join(','));
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts-export-${new Date().toLocaleDateString('sv-SE')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Export failed: ' + e.message);
    } finally {
      setExportingContacts(false);
    }
  };

  const toggleSelectContact = (id: number) => {
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkSetActive = async (value: 0 | 1) => {
    if (isAdvisor || selectedContacts.size === 0) return;
    setBulkWorking(true);
    try {
      await runInBatches([...selectedContacts], 10, async id => {
        await apiFetch(`/api/ims/contacts/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: value }),
        });
      });
      setSelectedContacts(new Set());
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBulkWorking(false);
    }
  };

  const handleBulkDelete = async () => {
    if (isAdvisor || selectedContacts.size === 0) return;
    if (!confirm(`Delete ${selectedContacts.size} contact(s)? This cannot be undone.`)) return;
    setBulkWorking(true);
    try {
      await runInBatches([...selectedContacts], 10, async id => {
        await apiFetch(`/api/ims/contacts/${id}`, { method: 'DELETE' });
      });
      setSelectedContacts(new Set());
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBulkWorking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url  = modal.edit ? `/api/ims/contacts/${modal.edit.id}` : '/api/ims/contacts';
      const method = modal.edit ? 'PUT' : 'POST';
      const f = form as any;
      const displayName = f.name || f.company || [f.first_name, f.last_name].filter(Boolean).join(' ') || 'Unnamed';
      const payload: any = {
        ...form,
        name: displayName,
        tax_rate: f.tax_rate === '' || f.tax_rate == null ? null : Number(f.tax_rate),
        on_account_limit: f.on_account_limit === '' || f.on_account_limit == null ? null : Number(f.on_account_limit),
        store_credit: f.store_credit === '' || f.store_credit == null ? 0 : Number(f.store_credit),
        date_of_birth: f.date_of_birth || null,
        gender: f.gender || null,
      };
      if (modal.edit) delete payload.store_credit;
      const result = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!modal.edit && (form.type === 'lead' || form.type === 'retail_customer')) {
        setTypeFilter(form.type);
        setPage(1);
      }
      load(); closeModal();
      const sync = result.shopifySync;
      if (sync?.success) {
        const verb = sync.action === 'created' ? 'created' : sync.action === 'linked' ? 'linked' : 'updated';
        flashSyncMsg(`Contact saved. Shopify customer ${verb}.`);
      } else if (sync?.action === 'error') {
        flashSyncMsg(`Contact saved. Shopify sync warning: ${sync.reason}`);
      } else if (sync?.action === 'skipped' && form.type === 'retail_customer') {
        flashSyncMsg(`Contact saved. Shopify sync skipped: ${sync.reason}`);
      }
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleToggleActive = async (c: any) => {
    const next = c.is_active ? 0 : 1;
    const label = next === 0 ? `Inactivate "${c.name}"?` : `Reactivate "${c.name}"?`;
    if (!confirm(label)) return;
    try {
      const result = await apiFetch(`/api/ims/contacts/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: next }) });
      load();
      const sync = result.shopifySync;
      if (sync?.action === 'error') flashSyncMsg(`Contact updated. Shopify sync warning: ${sync.reason}`);
      else if (sync?.action === 'skipped' && c.type === 'retail_customer') flashSyncMsg(`Contact updated. Shopify sync skipped: ${sync.reason}`);
    }
    catch (e: any) { alert(e.message); }
  };

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  const setContactIdentityField = (key: 'first_name' | 'last_name' | 'company') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm(previous => {
      const next = { ...previous, [key]: value };
      if (displayNameEdited) return next;
      const company = String(next.company ?? '').trim();
      const personName = [next.first_name, next.last_name].map(part => String(part ?? '').trim()).filter(Boolean).join(' ');
      return { ...next, name: company || personName };
    });
  };
  const wholesaleBrandSelection = (() => {
    const raw = (form as any).wholesale_allowed_brands_json;
    if (raw == null || raw === '') return null;
    if (Array.isArray(raw)) return raw as string[];
    try { return JSON.parse(raw) as string[]; } catch { return null; }
  })();
  const wholesaleContactEligible = contactSettings.sells_wholesale !== 'no'
    && (form.type === 'b2b_customer' || form.type === 'both')
    && form.price_tier === 'wholesale';

  const typeMatchFn = (c: any) => {
    if (typeFilter === 'crm_all') return isCrmCustomerType(c.type);
    if (!typeFilter || typeFilter === 'supplier') return c.type === 'supplier' || c.type === 'b2b_customer' || c.type === 'both';
    if (typeFilter === 'supplier_only') return c.type === 'supplier' || c.type === 'both';
    return c.type === typeFilter;
  };
  const matchesCrmLastTouch = (contactId: number) => {
    if (crmLastTouchFilter === 'all') return true;
    const raw = crmWorkspace.contactMeta[contactId]?.lastInteractionAt;
    if (crmLastTouchFilter === 'never') return !raw;
    if (!raw) return false;
    const parsed = new Date(String(raw).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(crmLastTouchFilter));
    return parsed >= cutoff;
  };
  const crmLastTouchLabel = (contactId: number) => {
    const raw = crmWorkspace.contactMeta[contactId]?.lastInteractionAt;
    if (!raw) return '—';
    const parsed = new Date(String(raw).replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const filterActive = priceTierFilter !== 'all' || activeFilter !== DEFAULT_STATUS_FILTER || storeCreditFilter !== 'all'
    || promoEmailFilter !== 'all' || promoSmsFilter !== 'all' || (isCrmMode && (crmTagFilter !== 'all'
    || crmFollowUpFilter !== 'all' || crmLastTouchFilter !== 'all' || crmLeadTemperatureFilter !== 'all'));
  const hasTextFilter = filter.trim().length > 0;
  const filtered = contacts.filter(c =>
    (hasTextFilter || typeMatchFn(c)) &&
    (!filter || c.name.toLowerCase().includes(filter.toLowerCase()) || (c.company || '').toLowerCase().includes(filter.toLowerCase()) || (c.customer_code || '').toLowerCase().includes(filter.toLowerCase()) || (c.email || '').toLowerCase().includes(filter.toLowerCase())) &&
    (priceTierFilter === 'all' || (priceTierFilter === 'wholesale' ? c.price_tier === 'wholesale' : (c.price_tier ?? 'retail') !== 'wholesale')) &&
    (activeFilter === 'all' || String(c.is_active) === activeFilter) &&
    (storeCreditFilter === 'all' || (storeCreditFilter === 'positive' ? Number(c.store_credit ?? 0) > 0 : Number(c.store_credit ?? 0) <= 0)) &&
    (promoEmailFilter === 'all' || String(Number(c.promo_email ?? 0)) === promoEmailFilter) &&
    (promoSmsFilter === 'all' || String(Number(c.promo_sms ?? 0)) === promoSmsFilter) &&
    (!isCrmMode || crmTagFilter === 'all' || (crmWorkspace.contactMeta[c.id]?.tags ?? []).some(tag => String(tag.id) === crmTagFilter)) &&
    (!isCrmMode || crmFollowUpFilter === 'all'
      || (crmFollowUpFilter === 'open' && Number(crmWorkspace.contactMeta[c.id]?.openTaskCount ?? 0) > 0)
      || (crmFollowUpFilter === 'overdue' && Number(crmWorkspace.contactMeta[c.id]?.overdueTaskCount ?? 0) > 0)
      || (crmFollowUpFilter === 'none' && Number(crmWorkspace.contactMeta[c.id]?.openTaskCount ?? 0) === 0)) &&
    (!isCrmMode || crmLeadTemperatureFilter === 'all' || c.lead_temperature === crmLeadTemperatureFilter) &&
    (!isCrmMode || matchesCrmLastTouch(c.id))
  );
  const CONTACTS_PAGE_SIZE = 100;
  const totalPages = Math.max(1, Math.ceil(filtered.length / CONTACTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * CONTACTS_PAGE_SIZE, safePage * CONTACTS_PAGE_SIZE);
  const visibleIds = visible.map(c => c.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedContacts.has(id));
  const f = form as any;
  const isSupplier = form.type === 'supplier' || form.type === 'both';
  const isCustomer = form.type === 'b2b_customer' || form.type === 'retail_customer' || form.type === 'both';

  return (
    <div style={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0, flex: 1 }}>{isCrmMode ? 'CRM' : 'Contacts'}</h1>
        {!isCrmMode && <button onClick={downloadContactsCsv} disabled={exportingContacts || contacts.length === 0} style={btnStyle('ghost')}>
          {exportingContacts ? 'Exporting…' : '⬇ Export CSV'}
        </button>}
        {!isCrmMode && !isAdvisor && <button onClick={() => setImportOpen(true)} style={btnStyle('ghost')}>⬆ Import Contacts</button>}
        {!isCrmMode && !isAdvisor && <button onClick={openNew} style={btnStyle('action')}>+ New Contact</button>}
      </div>
      {isCrmMode && <nav aria-label="CRM workspace sections" style={{ display: 'flex', width: 'fit-content', maxWidth: '100%', overflowX: 'auto', padding: 3, border: '1px solid var(--sv-etch)', borderRadius: 7, background: 'var(--sv-bg-2)', marginBottom: 14 }}>
        {(['contacts', 'tasks', 'segments', 'pipeline', 'data quality', 'analytics'] as const).map(section => <button key={section} onClick={() => setCrmSection(section)} style={{ border: 0, borderRadius: 5, padding: '7px 13px', background: crmSection === section ? 'var(--sv-bg-1)' : 'transparent', color: crmSection === section ? 'var(--sv-text-strong)' : 'var(--sv-text-dim)', fontWeight: 700, textTransform: 'capitalize', cursor: 'pointer', boxShadow: crmSection === section ? '0 1px 3px rgba(0,0,0,.12)' : 'none', whiteSpace: 'nowrap' }}>{section === 'contacts' ? 'Customers & Leads' : section}{section === 'tasks' && crmWorkspace.tasks.length ? ` (${crmWorkspace.tasks.length})` : ''}</button>)}
      </nav>}
      {isCrmMode && crmWorkspaceError && <div role="alert" style={{ marginBottom: 12, color: 'var(--sv-red)', fontSize: 12 }}>{crmWorkspaceError}</div>}
      {isCrmMode && crmSection === 'tasks' ? (
        crmWorkspaceLoading ? <Spinner /> : <ContactCrmTaskQueue tasks={crmWorkspace.tasks} truncated={crmWorkspace.taskTruncated} assignees={crmWorkspace.assignees} isAdvisor={isAdvisor} onOpenProfile={onOpenProfile} onTaskChanged={loadCrmWorkspace} />
      ) : isCrmMode && crmSection === 'segments' ? (
        crmWorkspaceLoading ? <Spinner /> : <ContactCrmSegments tags={crmWorkspace.tags} isAdvisor={isAdvisor} onOpenProfile={onOpenProfile} />
      ) : isCrmMode && crmSection === 'pipeline' ? (
        crmWorkspaceLoading ? <Spinner /> : <ContactCrmPipeline contacts={contacts} assignees={crmWorkspace.assignees} isAdvisor={isAdvisor} onOpenProfile={onOpenProfile} onContactsChanged={load} />
      ) : isCrmMode && crmSection === 'data quality' ? (
        <ContactCrmDataQuality isAdvisor={isAdvisor} onEditContact={id => { const contact = contacts.find(item => Number(item.id) === id); if (contact) openEdit(contact); }} onMerged={() => { load(); void loadCrmWorkspace(); }} />
      ) : isCrmMode && crmSection === 'analytics' ? (
        <ContactCrmAnalytics onOpenProfile={onOpenProfile} />
      ) : <>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input placeholder="Search all contacts…" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, minWidth: 220, flex: '1 1 220px' }} />
        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, minWidth: 220, flex: '1 1 220px' }}>
          {isCrmMode && <option value="crm_all">All Customers &amp; Leads</option>}
          {!isCrmMode && <option value="supplier">Suppliers + B2B Customers</option>}
          {!isCrmMode && <option value="supplier_only">Suppliers Only</option>}
          <option value="b2b_customer">B2B Customers</option>
          <option value="retail_customer">Retail Customers</option>
          <option value="lead">Leads</option>
          <option value="both">Supplier &amp; B2B Customer</option>
        </select>
        {filterActive && (
          <button onClick={() => {
            setPriceTierFilter('all');
            setActiveFilter(DEFAULT_STATUS_FILTER);
            setStoreCreditFilter('all');
            setPromoEmailFilter('all');
            setPromoSmsFilter('all');
            setCrmTagFilter('all');
            setCrmFollowUpFilter('all');
            setCrmLastTouchFilter('all');
            setCrmLeadTemperatureFilter('all');
            setPage(1);
          }} style={btnStyle('secondary', 'sm')}>Clear filters</button>
        )}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setContactsFiltersOpen(v => !v)} style={{ ...btnStyle('secondary', 'sm'), ...(filterActive ? { background: 'color-mix(in srgb, var(--sv-action) 12%, var(--sv-bg-2))', borderColor: 'var(--sv-action)', color: 'var(--sv-action)' } : {}) }}>
            Filters ▾{filterActive ? ' ●' : ''}
          </button>
          {contactsFiltersOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setContactsFiltersOpen(false)} />
              <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 100, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '14px 16px', marginTop: 4, minWidth: 280, boxShadow: '0 6px 20px rgba(0,0,0,0.14)' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>Filters</p>
                {isCrmMode && <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>CRM Tag</label>
                  <select value={crmTagFilter} onChange={e => { setCrmTagFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">All tags</option>
                    {crmWorkspace.tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                  </select>
                </div>}
                {isCrmMode && <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>Follow-ups</label>
                  <select value={crmFollowUpFilter} onChange={e => { setCrmFollowUpFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">All contacts</option>
                    <option value="open">Has open tasks</option>
                    <option value="overdue">Has overdue tasks</option>
                    <option value="none">No open tasks</option>
                  </select>
                </div>}
                {isCrmMode && <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>Lead Qualification</label>
                  <select value={crmLeadTemperatureFilter} onChange={e => { setCrmLeadTemperatureFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">All qualifications</option>
                    <option value="cold">Cold</option>
                    <option value="warm">Warm</option>
                    <option value="hot">Hot</option>
                  </select>
                </div>}
                {isCrmMode && <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>Last CRM Touch</label>
                  <select value={crmLastTouchFilter} onChange={e => { setCrmLastTouchFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">Any time</option>
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="never">Never contacted</option>
                  </select>
                </div>}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>Price Tier</label>
                  <select value={priceTierFilter} onChange={e => { setPriceTierFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">All</option>
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale</option>
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>Status</label>
                  <select value={activeFilter} onChange={e => { setActiveFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">All</option>
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>Store Credit</label>
                  <select value={storeCreditFilter} onChange={e => { setStoreCreditFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">All</option>
                    <option value="positive">&gt; 0</option>
                    <option value="zero">0</option>
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>Promo Emails</label>
                  <select value={promoEmailFilter} onChange={e => { setPromoEmailFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">All</option>
                    <option value="1">Opted in</option>
                    <option value="0">Opted out</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sv-text-dim)', display: 'block', marginBottom: 4 }}>Promo SMS</label>
                  <select value={promoSmsFilter} onChange={e => { setPromoSmsFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, width: '100%' }}>
                    <option value="all">All</option>
                    <option value="1">Opted in</option>
                    <option value="0">Opted out</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {syncMsg && (
        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(99,102,241,.25)', background: 'rgba(99,102,241,.08)', color: 'var(--sv-text-main)', fontSize: 13 }}>
          {syncMsg}
        </div>
      )}
      {!isCrmMode && !isAdvisor && selectedContacts.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', flex: 1 }}>{selectedContacts.size} contact{selectedContacts.size !== 1 ? 's' : ''} selected</span>
          <button disabled={bulkWorking} onClick={() => handleBulkSetActive(1)} style={btnStyle('secondary', 'sm')}>Activate</button>
          <button disabled={bulkWorking} onClick={() => handleBulkSetActive(0)} style={btnStyle('secondary', 'sm')}>Inactivate</button>
          <button disabled={bulkWorking} onClick={handleBulkDelete} style={btnStyle('danger', 'sm')}>Delete</button>
          <button onClick={() => setSelectedContacts(new Set())} style={btnStyle('secondary', 'sm')}>Deselect all</button>
        </div>
      )}
      {loading ? <Spinner /> : (() => {
        const isCustomerView = isCrmMode || typeFilter === 'b2b_customer' || typeFilter === 'retail_customer';
        const isSupplierView = typeFilter === 'supplier' || typeFilter === 'both';
        const typeBadge = (c: any) => (
          <span style={{ display: 'inline-flex', fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
            background: c.type === 'supplier' ? 'rgba(34,197,94,.12)' : c.type === 'b2b_customer' ? 'rgba(139,92,246,.15)' : c.type === 'retail_customer' ? 'rgba(37,99,235,.15)' : c.type === 'lead' ? 'rgba(251,146,60,.15)' : 'rgba(100,116,139,.15)',
            color: c.type === 'supplier' ? '#166534' : c.type === 'b2b_customer' ? '#a78bfa' : c.type === 'retail_customer' ? '#60a5fa' : c.type === 'lead' ? '#fb923c' : '#94a3b8' }}>
            {CONTACT_TYPE_LABEL[c.type] ?? c.type}
          </span>
        );
        const leadTemperatureBadge = (c: any) => c.type === 'lead' && c.lead_temperature
          ? <span style={{ display: 'inline-flex', fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: c.lead_temperature === 'hot' ? 'rgba(220,38,38,.12)' : c.lead_temperature === 'warm' ? 'rgba(217,119,6,.14)' : 'rgba(37,99,235,.12)',
            color: c.lead_temperature === 'hot' ? '#dc2626' : c.lead_temperature === 'warm' ? '#b45309' : '#2563eb', textTransform: 'capitalize' }}>{c.lead_temperature}</span>
          : '—';
        const codeCell = (value: string | number | null | undefined) => (
          <span style={{ display: 'inline-block', minWidth: 108, fontSize: 11, color: 'var(--sv-text-dim)', fontVariantNumeric: 'tabular-nums' }}>{value || '—'}</span>
        );
        const nameCell = (c: any) => isAdvisor
          ? <strong style={{ color: 'var(--sv-text-main)' }}>{c.name}</strong>
          : <button onClick={() => isCrmMode ? onOpenProfile(c.id) : openEdit(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}><strong style={{ color: 'var(--sv-action)' }}>{c.name}</strong></button>;
        const actions = (c: any) => (
          <div style={{ display: 'flex', gap: 4 }}>
            {!isCrmMode && !isAdvisor && <button onClick={() => openEdit(c)} style={btnStyle('ghost', 'xs')}>Edit</button>}
            {isCrmMode && <button onClick={() => onOpenProfile(c.id)} style={btnStyle('ghost', 'xs')}>Open</button>}
            {!isCrmMode && !isAdvisor && <button onClick={() => handleToggleActive(c)} style={btnStyle(c.is_active ? 'danger' : 'mint', 'xs')}>{c.is_active ? 'Inactivate' : 'Reactivate'}</button>}
          </div>
        );
        if (isCustomerView) return (
          <ImsTable
            cols={[
              !isCrmMode && !isAdvisor ? <input key="customer-select-all" type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedContacts(prev => {
                const next = new Set(prev);
                if (allVisibleSelected) visible.forEach(c => next.delete(c.id));
                else visible.forEach(c => next.add(c.id));
                return next;
              })} style={{ cursor: 'pointer' }} /> : '',
              'Name', 'Code', 'Group', 'Type', ...(isCrmMode ? ['Qualification', 'Tags', 'Follow-ups', 'Last CRM Touch'] : []), 'Email', 'Mobile', typeFilter === 'b2b_customer' ? 'Price Tier' : 'Store Credit', 'On Account', '',
            ]}
            rows={visible}
            background="var(--sv-bg-1)"
            headerBackground="var(--sv-bg-2)"
            columnWidths={isCrmMode ? [44, 220, 130, 150, 130, 110, 190, 120, 140, 240, 150, 130, 130, 190] : [44, 220, 130, 150, 130, 240, 150, 130, 130, 190]}
            frozenColumnIndex={1}
            scrollClassName="contacts-table-scroll"
            render={(c) => [
              !isCrmMode && !isAdvisor ? <input type="checkbox" checked={selectedContacts.has(c.id)} onChange={() => toggleSelectContact(c.id)} style={{ cursor: 'pointer' }} /> : null,
              nameCell(c),
              codeCell(c.customer_code),
              c.customer_group || '—',
              typeBadge(c),
              ...(isCrmMode ? [leadTemperatureBadge(c), (crmWorkspace.contactMeta[c.id]?.tags ?? []).length
                ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{crmWorkspace.contactMeta[c.id].tags.map(tag => <span key={tag.id} style={{ padding: '2px 5px', borderRadius: 4, background: 'color-mix(in srgb, var(--sv-action) 10%, var(--sv-bg-1))', color: 'var(--sv-action)', fontSize: 10, fontWeight: 700 }}>{tag.name}</span>)}</div>
                : '—',
              Number(crmWorkspace.contactMeta[c.id]?.openTaskCount ?? 0) > 0
                ? <span style={{ color: Number(crmWorkspace.contactMeta[c.id]?.overdueTaskCount ?? 0) > 0 ? 'var(--sv-red)' : 'var(--sv-text-main)', fontWeight: 700 }}>{crmWorkspace.contactMeta[c.id].openTaskCount} open{Number(crmWorkspace.contactMeta[c.id]?.overdueTaskCount ?? 0) > 0 ? ` · ${crmWorkspace.contactMeta[c.id].overdueTaskCount} overdue` : ''}</span>
                : '—',
              crmLastTouchLabel(c.id)] : []),
              c.email || '—',
              c.mobile || c.phone || '—',
              typeFilter === 'b2b_customer'
                ? (c.price_tier === 'wholesale'
                  ? <span style={{ background: 'rgba(139,92,246,.18)', color: '#a78bfa', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600 }}>Wholesale</span>
                  : <span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>Retail</span>)
                : Number(c.store_credit) > 0
                  ? <span style={{ color: 'var(--sv-mint)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>${Number(c.store_credit).toFixed(2)}</span>
                  : <span style={{ color: 'var(--sv-text-dim)' }}>—</span>,
              c.on_account_limit != null
                ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(c.on_account_limit).toFixed(2)}</span>
                : <span style={{ color: 'var(--sv-text-dim)' }}>—</span>,
              actions(c),
            ]}
          />
        );
        return (
          <ImsTable
            cols={[
              !isAdvisor ? <input key="supplier-select-all" type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedContacts(prev => {
                const next = new Set(prev);
                if (allVisibleSelected) visible.forEach(c => next.delete(c.id));
                else visible.forEach(c => next.add(c.id));
                return next;
              })} style={{ cursor: 'pointer' }} /> : '',
              ...(isSupplierView
                ? ['Name', 'Company', 'Type', 'Price Tier', 'Email', 'Phone', '']
                : ['Name', 'Company', 'Type', 'Email', 'Mobile / Phone', ''])
            ]}
            rows={visible}
            background="var(--sv-bg-1)"
            headerBackground="var(--sv-bg-2)"
            columnWidths={isSupplierView
              ? [44, 220, 180, 130, 120, 240, 150, 190]
              : [44, 220, 180, 130, 240, 160, 190]}
            frozenColumnIndex={1}
            scrollClassName="contacts-table-scroll"
            render={(c) => isSupplierView ? [
              !isAdvisor ? <input type="checkbox" checked={selectedContacts.has(c.id)} onChange={() => toggleSelectContact(c.id)} style={{ cursor: 'pointer' }} /> : null,
              nameCell(c),
              c.company || '—',
              typeBadge(c),
              c.price_tier === 'wholesale'
                ? <span style={{ background: 'rgba(139,92,246,.18)', color: '#a78bfa', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600 }}>Wholesale</span>
                : <span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>Retail</span>,
              c.email || '—',
              c.phone || '—',
              actions(c),
            ] : [
              !isAdvisor ? <input type="checkbox" checked={selectedContacts.has(c.id)} onChange={() => toggleSelectContact(c.id)} style={{ cursor: 'pointer' }} /> : null,
              nameCell(c),
              c.company || '—',
              typeBadge(c),
              c.email || '—',
              c.mobile || c.phone || '—',
              actions(c),
            ]}
          />
        );
      })()}
      {/* ── Pagination ── */}
      {!loading && totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16 }}>
          <button onClick={() => setPage(1)} disabled={safePage === 1} style={btnStyle('secondary', 'sm')}>«</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} style={btnStyle('secondary', 'sm')}>‹ Prev</button>
          <span style={{ fontSize: 13, color: 'var(--sv-text-dim)', padding: '0 8px' }}>Page {safePage} of {totalPages} ({filtered.length} contacts)</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={btnStyle('secondary', 'sm')}>Next ›</button>
          <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} style={btnStyle('secondary', 'sm')}>»</button>
        </div>
      )}
      </>}

      {!isCrmMode && !isAdvisor && importOpen && (
        <ImportContactsModal
          contacts={contacts}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); load(); }}
        />
      )}

      {modal.open && (
        <Modal title={modal.edit ? 'Edit Contact' : 'New Contact'} onClose={closeModal}>
          <form onSubmit={handleSubmit}>
            <Row2>
              <Field label="Type">
                <select value={form.type} onChange={sf('type')} style={inputStyle}>
                  <option value="supplier">Supplier</option>
                  <option value="b2b_customer">B2B Customer</option>
                  <option value="retail_customer">Retail Customer</option>
                  <option value="lead">Lead</option>
                  <option value="both">Supplier &amp; B2B Customer</option>
                </select>
              </Field>
              <Field label="Active">
                <select value={form.is_active} onChange={sf('is_active')} style={inputStyle}>
                  <option value={1}>Yes</option>
                  <option value={0}>No</option>
                </select>
              </Field>
            </Row2>

            {form.type === 'lead' && <Field label="Lead Qualification">
              <select value={f.lead_temperature ?? 'warm'} onChange={sf('lead_temperature')} style={inputStyle}>
                <option value="cold">Cold</option>
                <option value="warm">Warm</option>
                <option value="hot">Hot</option>
              </select>
            </Field>}

            <Row2>
              <Field label="First Name"><input value={f.first_name ?? ''} onChange={setContactIdentityField('first_name')} style={inputStyle} /></Field>
              <Field label="Last Name"><input value={f.last_name ?? ''} onChange={setContactIdentityField('last_name')} style={inputStyle} /></Field>
            </Row2>
            <Row2>
              <Field label="Display Name *"><input required value={form.name} onChange={event => {
                const value = event.target.value;
                const isManualName = Boolean(value.trim());
                setDisplayNameEdited(isManualName);
                setForm(previous => ({
                  ...previous,
                  name: isManualName
                    ? value
                    : String(previous.company ?? '').trim() || [previous.first_name, previous.last_name].map(part => String(part ?? '').trim()).filter(Boolean).join(' '),
                }));
              }} placeholder="Auto-filled from Company or contact name" style={inputStyle} /></Field>
              <Field label="Company"><input value={form.company} onChange={setContactIdentityField('company')} style={inputStyle} /></Field>
            </Row2>
            <Row2>
              <Field label="Customer Code"><input value={f.customer_code ?? ''} onChange={sf('customer_code')} style={inputStyle} /></Field>
              <Field label="Customer Group"><input value={f.customer_group ?? ''} onChange={sf('customer_group')} style={inputStyle} /></Field>
            </Row2>

            <Row2>
              <Field label="Email"><input type="email" value={form.email} onChange={sf('email')} style={inputStyle} /></Field>
              <Field label="Mobile"><input value={f.mobile ?? ''} onChange={sf('mobile')} style={inputStyle} /></Field>
            </Row2>
            <Row2>
              <Field label="Phone"><input value={form.phone} onChange={sf('phone')} style={inputStyle} /></Field>
              <Field label="Website URL"><input type="url" value={f.website_url ?? ''} onChange={sf('website_url')} placeholder="https://" style={inputStyle} /></Field>
            </Row2>

            <SectionLabel>Address</SectionLabel>
            <Field label="Street Address"><input value={form.address} onChange={sf('address')} style={inputStyle} /></Field>
            <Field label="Apt / Suite / Unit"><input value={f.address2 ?? ''} onChange={sf('address2')} style={inputStyle} placeholder="Unit 3, Level 2, etc." /></Field>
            <Row2>
              <Field label="Suburb"><input value={f.suburb ?? ''} onChange={sf('suburb')} style={inputStyle} /></Field>
              <Field label="City"><input value={form.city} onChange={sf('city')} style={inputStyle} /></Field>
            </Row2>
            <Row3>
              <Field label="State"><input value={form.state} onChange={sf('state')} style={inputStyle} /></Field>
              <Field label="Postcode"><input value={form.postcode} onChange={sf('postcode')} style={inputStyle} /></Field>
              <Field label="Country"><input value={form.country} onChange={sf('country')} style={inputStyle} /></Field>
            </Row3>

            {isCustomer && (
              <div style={{ marginTop: 14 }}>
                <SectionLabel>Customer Details</SectionLabel>
                <Row2>
                  <Field label="Store Credit ($)"><input type="number" value={f.store_credit ?? 0} readOnly title="Read-only balance updated by completed manual or POS-generated customer credit notes." style={{ ...inputStyle, opacity: .72, cursor: 'not-allowed' }} /></Field>
                  <Field label="On Account Limit ($)"><input type="number" min="0" step="0.01" value={f.on_account_limit ?? ''} onChange={sf('on_account_limit')} style={inputStyle} /></Field>
                </Row2>
                {(form.type === 'b2b_customer' || form.type === 'both') && <Field label="Customer early-payment default">
                  <select value={f.customer_early_payment_discount_rule_id ?? ''} onChange={sf('customer_early_payment_discount_rule_id')} style={inputStyle}>
                    <option value="">No default</option>
                    {earlyPaymentRules.filter(rule => Number(rule.is_active) || Number(rule.id) === Number(f.customer_early_payment_discount_rule_id)).map(rule => <option key={rule.id} value={rule.id}>{rule.name}{rule.is_active ? '' : ' (inactive)'}</option>)}
                  </select>
                  {earlyPaymentRules.filter(rule => Number(rule.is_active)).length === 0 && <div style={{ marginTop: 5, fontSize: 11, color: 'var(--sv-text-dim)' }}>Create a rule in Settings → Payment Discounts, then return here to select it.</div>}
                </Field>}
                <Row2>
                  <Field label="Price Tier">
                    <select value={f.price_tier ?? 'retail'} onChange={sf('price_tier')} style={inputStyle}>
                      <option value="retail">Retail</option>
                      <option value="wholesale">Wholesale</option>
                    </select>
                  </Field>
                  <Field label="Promo Emails">
                    <select value={Number(f.promo_email ?? 0)} onChange={e => setForm(p => ({ ...p, promo_email: Number(e.target.value) }))} style={inputStyle}>
                      <option value={1}>Opted in</option>
                      <option value={0}>Opted out</option>
                    </select>
                  </Field>
                </Row2>
                <Row2>
                  <Field label="Promo SMS">
                    <select value={Number(f.promo_sms ?? 0)} onChange={e => setForm(p => ({ ...p, promo_sms: Number(e.target.value) }))} style={inputStyle}>
                      <option value={1}>Opted in</option>
                      <option value={0}>Opted out</option>
                    </select>
                  </Field>
                  <Field label="Date of Birth"><input type="date" value={f.date_of_birth ?? ''} onChange={sf('date_of_birth')} style={inputStyle} /></Field>
                </Row2>
                {wholesaleContactEligible && (
                  <details style={{ marginTop: 14, borderTop: '1px solid var(--sv-etch)', paddingTop: 12 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--sv-text-strong)' }}>
                      Wholesale Brand Access · {wholesaleBrandSelection === null ? 'All brands' : wholesaleBrandSelection.length === 0 ? 'No brands' : `${wholesaleBrandSelection.length} of ${wholesaleBrands.length} brands`}
                    </summary>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                        <button type="button" onClick={() => setForm(p => ({ ...p, wholesale_allowed_brands_json: null }))} style={btnStyle('secondary', 'sm')}>Allow all</button>
                        <button type="button" onClick={() => setForm(p => ({ ...p, wholesale_allowed_brands_json: [] }))} style={btnStyle('secondary', 'sm')}>Unallow all</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                        {wholesaleBrands.map(brand => {
                          const checked = wholesaleBrandSelection === null || wholesaleBrandSelection.some(item => item.toLocaleLowerCase('en-AU') === brand.toLocaleLowerCase('en-AU'));
                          return <label key={brand} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--sv-text-main)' }}>
                            <input type="checkbox" checked={checked} onChange={event => setForm(previous => {
                              const raw = (previous as any).wholesale_allowed_brands_json;
                              let selected: string[] = raw == null ? [...wholesaleBrands] : Array.isArray(raw) ? raw : (() => { try { return JSON.parse(raw); } catch { return []; } })();
                              selected = event.target.checked ? [...new Set([...selected, brand])] : selected.filter(item => item.toLocaleLowerCase('en-AU') !== brand.toLocaleLowerCase('en-AU'));
                              return { ...previous, wholesale_allowed_brands_json: selected };
                            })} />
                            <span>{brand}</span>
                          </label>;
                        })}
                        {wholesaleBrands.length === 0 && <span style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>No wholesale-priced product brands are available.</span>}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            )}

            {isSupplier && (
              <div style={{ marginTop: 14 }}>
                <SectionLabel>Supplier Settings</SectionLabel>
                <Field label="Supplier early-payment default">
                  <select value={f.supplier_early_payment_discount_rule_id ?? ''} onChange={sf('supplier_early_payment_discount_rule_id')} style={inputStyle}>
                    <option value="">No default</option>
                    {earlyPaymentRules.filter(rule => Number(rule.is_active) || Number(rule.id) === Number(f.supplier_early_payment_discount_rule_id)).map(rule => <option key={rule.id} value={rule.id}>{rule.name}{rule.is_active ? '' : ' (inactive)'}</option>)}
                  </select>
                  {earlyPaymentRules.filter(rule => Number(rule.is_active)).length === 0 && <div style={{ marginTop: 5, fontSize: 11, color: 'var(--sv-text-dim)' }}>Create a rule in Settings → Payment Discounts, then return here to select it.</div>}
                </Field>
                <Row2>
                  <Field label="Order Frequency (days)"><input type="number" min={1} value={f.order_frequency_days ?? 45} onChange={e => setForm(p => ({ ...p, order_frequency_days: Math.max(1, parseInt(e.target.value) || 45) }))} style={inputStyle} /></Field>
                  <Field label="Charges sales tax?">
                    <select value={Number(f.charges_tax ?? 1)} onChange={e => setForm(p => ({ ...p, charges_tax: Number(e.target.value) }))} style={inputStyle}>
                      <option value={1}>Yes</option>
                      <option value={0}>No</option>
                    </select>
                  </Field>
                </Row2>
                <Row2>
                  <Field label="Prices include tax?">
                    <select value={Number(f.prices_include_tax ?? 0)} disabled={!Number(f.charges_tax ?? 1)} onChange={e => setForm(p => ({ ...p, prices_include_tax: Number(e.target.value) }))} style={{ ...inputStyle, opacity: Number(f.charges_tax ?? 1) ? 1 : 0.5 }}>
                      <option value={0}>Ex-tax</option>
                      <option value={1}>Inc-tax</option>
                    </select>
                  </Field>
                  <Field label="Tax rate override (%)"><input type="number" min={0} step="0.01" disabled={!Number(f.charges_tax ?? 1)} value={f.tax_rate === '' || f.tax_rate == null ? '' : Number(f.tax_rate) * 100} onChange={e => setForm(p => ({ ...p, tax_rate: e.target.value === '' ? '' : String(Number(e.target.value) / 100) }))} style={{ ...inputStyle, opacity: Number(f.charges_tax ?? 1) ? 1 : 0.5 }} /></Field>
                </Row2>
              </div>
            )}

            <SectionLabel>Notes</SectionLabel>
            <Field label="">
              <textarea value={form.notes} onChange={sf('notes') as any} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Internal notes…" />
            </Field>

            {modal.edit?.id && <ContactOnlineStoreSection contactId={Number(modal.edit.id)} />}
            {modal.edit?.id && <ContactGiftCardsSection contactId={Number(modal.edit.id)} />}

            <FormActions onCancel={closeModal} saving={saving} isEdit={!!modal.edit} createLabel="Save" />
          </form>
        </Modal>
      )}
    </div>
  );
}

function ImportContactsModal({ contacts, onClose, onDone }: {
  contacts: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<'paste' | 'review' | 'importing' | 'done'>('paste');
  const [pasteText, setPasteText] = useState(CONTACT_EXPORT_HEADERS.join('\t'));
  const [rows, setRows] = useState<ParsedContactImportRow[]>([]);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: string[] } | null>(null);

  const headerSet = useMemo(() => new Set(CONTACT_EXPORT_HEADERS.map(h => h.toLowerCase())), []);

  const existing = useMemo(() => {
    const byId = new Map<number, any>();
    const byCode = new Map<string, any>();
    const byShopifyId = new Map<string, any>();
    const byEmail = new Map<string, any>();
    for (const c of contacts) {
      byId.set(Number(c.id), c);
      if (String(c.customer_code ?? '').trim()) byCode.set(String(c.customer_code).trim().toLowerCase(), c);
      if (String(c.shopify_customer_id ?? '').trim()) byShopifyId.set(String(c.shopify_customer_id).trim(), c);
      if (String(c.email ?? '').trim()) byEmail.set(String(c.email).trim().toLowerCase(), c);
    }
    return { byId, byCode, byShopifyId, byEmail };
  }, [contacts]);

  const parseRows = () => {
    const lines = pasteText.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
    if (lines.length < 2) return [];

    const firstCells = lines[0].split('\t').map(h => normalizeContactHeader(h));
    const isHeaderLine = firstCells.some(c => headerSet.has(c));
    const headers = isHeaderLine ? firstCells : CONTACT_EXPORT_HEADERS.map(h => h.toLowerCase());
    const dataLines = isHeaderLine ? lines.slice(1) : lines;

    return dataLines.map(line => {
      const cells = line.split('\t');
      const raw: Record<string, string> = {};
      headers.forEach((h, i) => { raw[h] = (cells[i] ?? '').trim(); });

      const id = contactNum(raw.id);
      const customerCode = String(raw.customer_code ?? '').trim().toLowerCase();
      const shopifyId = String(raw.shopify_customer_id ?? '').trim();
      const email = String(raw.email ?? '').trim().toLowerCase();

      const match =
        (id != null && existing.byId.get(id)) ||
        (customerCode && existing.byCode.get(customerCode)) ||
        (shopifyId && existing.byShopifyId.get(shopifyId)) ||
        (email && existing.byEmail.get(email));

      if (!raw.type?.trim()) {
        return { raw, action: 'error' as const, errorMsg: 'Missing Type' };
      }

      if (match) {
        const changedFields = CONTACT_EXPORT_HEADERS.filter(key => {
          if (key === 'id') return false;
          const incoming = raw[key.toLowerCase()] ?? raw[key] ?? '';
          const current = String((match as any)[key] ?? '');
          return String(incoming ?? '').trim() !== current.trim();
        }).map(String);
        return { raw, action: 'update' as const, existingId: Number(match.id), changedFields };
      }

      return { raw, action: 'new_contact' as const };
    }).filter(r => Object.values(r.raw).some(v => String(v ?? '').trim()));
  };

  const handleNext = () => {
    const parsed = parseRows();
    if (!parsed.length) { alert('No data rows found. Paste your contacts below the header row.'); return; }
    setRows(parsed);
    setStage('review');
  };

  const handleImport = async () => {
    setStage('importing');
    const errors: string[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      for (const row of rows) {
        if (row.action === 'error') { skipped++; errors.push(row.errorMsg ?? 'Invalid row'); continue; }

        const raw = row.raw;
        const payload: Record<string, any> = {
          type: raw.type as any,
          name: raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(' ') || raw.company || 'Unnamed',
          first_name: raw.first_name || undefined,
          last_name: raw.last_name || undefined,
          company: raw.company || undefined,
          customer_code: raw.customer_code || undefined,
          customer_group: raw.customer_group || undefined,
          shopify_customer_id: raw.shopify_customer_id || undefined,
          email: raw.email || undefined,
          phone: raw.phone || undefined,
          mobile: raw.mobile || undefined,
          address: raw.address || undefined,
          address2: raw.address2 || undefined,
          suburb: raw.suburb || undefined,
          city: raw.city || undefined,
          state: raw.state || undefined,
          postcode: raw.postcode || undefined,
          country: raw.country || undefined,
          notes: raw.notes || undefined,
          is_active: contactBool(raw.is_active) ?? 1,
          store_credit: contactNum(raw.store_credit) ?? 0,
          on_account_limit: contactNum(raw.on_account_limit) ?? undefined,
          date_of_birth: raw.date_of_birth || undefined,
          gender: raw.gender || undefined,
          promo_email: contactBool(raw.promo_email) ?? 0,
          promo_sms: contactBool(raw.promo_sms) ?? 0,
          price_tier: raw.price_tier || undefined,
          lead_time_days: contactNum(raw.lead_time_days) ?? undefined,
          order_frequency_days: contactNum(raw.order_frequency_days) ?? undefined,
          charges_tax: contactBool(raw.charges_tax) ?? 1,
          prices_include_tax: contactBool(raw.prices_include_tax) ?? 0,
          tax_rate: raw.tax_rate === '' || raw.tax_rate == null ? undefined : Number(raw.tax_rate),
          website_url: raw.website_url || undefined,
          cin7_supplier_id: contactNum(raw.cin7_supplier_id) ?? undefined,
          cin7_contact_id: contactNum(raw.cin7_contact_id) ?? undefined,
        };

        try {
          if (row.action === 'update' && row.existingId) {
            await apiFetch(`/api/ims/contacts/${row.existingId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            updated++;
          } else {
            await apiFetch('/api/ims/contacts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            created++;
          }
        } catch (e: any) {
          skipped++;
          errors.push(`${payload.name}: ${e.message}`);
        }
      }

      setResult({ created, updated, skipped, errors });
      setStage('done');
      onDone();
    } catch (e: any) {
      alert(e.message);
      setStage('review');
    }
  };

  const previewRows = rows.slice(0, 50);

  return (
    <Modal title="Import Contacts" onClose={onClose} wide wider>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {stage === 'paste' && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
              Copy the header row below into Excel or Google Sheets, fill your contact rows underneath it, then paste the whole block back here.
            </p>
            <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-2)', fontSize: 12, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
              {CONTACT_FIELD_GUIDE.map(field => (
                <div key={field.key} style={{ marginBottom: 8 }}>
                  <strong style={{ color: 'var(--sv-text-main)' }}>{field.label}</strong> — {field.description}<br />
                  <span style={{ color: 'var(--sv-text-dim)' }}>Example:</span> <code style={{ fontFamily: 'monospace', background: 'var(--sv-bg-0)', padding: '1px 4px', borderRadius: 3 }}>{field.example}</code>
                </div>
              ))}
            </div>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              spellCheck={false}
              style={{ width: '100%', minHeight: 220, fontFamily: 'monospace', fontSize: 12, background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, color: 'var(--sv-text-main)', padding: 12, resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
              <button type="button" onClick={handleNext} style={btnStyle('action')}>Review Contacts</button>
            </div>
          </>
        )}

        {stage === 'review' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 700, color: 'var(--sv-text-strong)' }}>Review import</div>
              <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{rows.length} row{rows.length !== 1 ? 's' : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{rows.filter(r => r.action === 'update').length} update{rows.filter(r => r.action === 'update').length !== 1 ? 's' : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{rows.filter(r => r.action === 'new_contact').length} new</div>
              <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{rows.filter(r => r.action === 'error').length} errors</div>
            </div>
            <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--sv-etch)', borderRadius: 8, background: 'var(--sv-bg-2)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--sv-etch)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Action</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Name</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Email</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Phone</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid var(--sv-etch)' }}>
                      <td style={{ padding: '8px 10px' }}>{row.action === 'update' ? 'Update' : row.action === 'new_contact' ? 'New' : 'Error'}</td>
                      <td style={{ padding: '8px 10px' }}>{row.raw.name || [row.raw.first_name, row.raw.last_name].filter(Boolean).join(' ') || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>{row.raw.type || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>{row.raw.email || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>{row.raw.mobile || row.raw.phone || '—'}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--sv-text-dim)' }}>{row.errorMsg || (row.changedFields?.length ? row.changedFields.slice(0, 4).join(', ') : '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setStage('paste')} style={btnStyle('ghost')}>Back</button>
              <button type="button" onClick={handleImport} style={btnStyle('action')}>Import {rows.length} Contact{rows.length !== 1 ? 's' : ''}</button>
            </div>
          </>
        )}

        {stage === 'importing' && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--sv-text-dim)' }}>Importing contacts…</div>
        )}

        {stage === 'done' && result && (
          <>
            <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(16,185,129,.25)', background: 'rgba(16,185,129,.08)', color: 'var(--sv-text-main)', fontSize: 13 }}>
              <strong style={{ color: '#34d399' }}>Import complete</strong>
              <div style={{ marginTop: 6 }}>Created {result.created}, updated {result.updated}, skipped {result.skipped}.</div>
            </div>
            {result.errors.length > 0 && (
              <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(248,113,113,.25)', background: 'rgba(248,113,113,.08)', color: 'var(--sv-text-main)', fontSize: 12, maxHeight: 160, overflow: 'auto' }}>
                {result.errors.slice(0, 12).map((err, idx) => <div key={idx}>{err}</div>)}
                {result.errors.length > 12 && <div>…and {result.errors.length - 12} more</div>}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose} style={btnStyle('ghost')}>Close</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Locations View
// ─────────────────────────────────────────────────────────────────────────────

const BLANK_LOC = { name: '', code: '', address: '', phone: '', city: '', state: '', postcode: '', country: 'Australia', is_active: 1, pos_pin: '', pos_location_code: '', has_pos: 0, has_wholesale: 0, has_online: 0, manager_pin: '', clear_manager_pin: false };
const LOC_TARGET_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function LocationRegistersPanel({ locationId, locationName, onClose }: { locationId: number; locationName: string; onClose: () => void }) {
  const [registers, setRegisters] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [adding,    setAdding]    = useState(false);
  const [newName,   setNewName]   = useState('');
  const [newFloat,  setNewFloat]  = useState('');
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/pos/registers?location_id=${locationId}&include_inactive=1`)
      .then(r => r.json())
      .then(d => setRegisters(d.registers ?? []))
      .finally(() => setLoading(false));
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/pos/registers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: locationId, name: newName.trim(), default_float: newFloat ? Number(newFloat) : 0 }),
      });
      if (res) { setNewName(''); setNewFloat(''); setAdding(false); load(); }
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleToggle(reg: any) {
    try {
      await apiFetch(`/api/pos/registers/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: reg.is_active ? 0 : 1 }),
      });
      load();
    } catch (e: any) { alert(e.message); }
  }

  async function handleRename(reg: any) {
    const name = prompt('New register name:', reg.name);
    if (!name || name === reg.name) return;
    try {
      await apiFetch(`/api/pos/registers/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      load();
    } catch (e: any) { alert(e.message); }
  }

  async function handleFloat(reg: any) {
    const val = prompt('Default float amount ($):', String(reg.default_float ?? 0));
    if (val === null) return;
    const n = Number(val);
    if (isNaN(n)) { alert('Enter a valid number.'); return; }
    try {
      await apiFetch(`/api/pos/registers/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_float: n }),
      });
      load();
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div style={{ marginTop: 16, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 10, padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--sv-text-strong)', flex: 1 }}>
          Registers — {locationName}
        </span>
        <button onClick={() => setAdding(a => !a)} style={btnStyle('action', 'xs')}>+ Add Register</button>
        <button onClick={onClose} style={btnStyle('ghost', 'xs')}>✕ Close</button>
      </div>
      {adding && (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
          <Field label="Register Name">
            <input autoFocus required value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Till 1" style={{ ...inputStyle, marginBottom: 0 }} />
          </Field>
          <Field label="Default Float ($)">
            <input type="number" min="0" step="0.01" value={newFloat} onChange={e => setNewFloat(e.target.value)} placeholder="0.00" style={{ ...inputStyle, width: 100, marginBottom: 0 }} />
          </Field>
          <button type="submit" disabled={saving || !newName.trim()} style={{ ...btnStyle('action', 'sm'), marginBottom: 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => setAdding(false)} style={{ ...btnStyle('ghost', 'sm'), marginBottom: 1 }}>Cancel</button>
        </form>
      )}
      {loading ? <Spinner /> : registers.length === 0 ? (
        <p style={{ color: 'var(--sv-text-dim)', fontSize: 13, padding: '8px 0' }}>No registers yet. Click "+ Add Register" to create one.</p>
      ) : (
        <div style={{ background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--sv-etch)' }}>
                {['Name', 'Default Float', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--sv-text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .8, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {registers.map(reg => (
                <tr key={reg.id} style={{ borderTop: '1px solid var(--sv-etch)', opacity: reg.is_active ? 1 : 0.5 }}>
                  <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--sv-text-main)', fontWeight: 500 }}>{reg.name}</td>
                  <td style={{ padding: '8px 12px', fontSize: 13, color: 'var(--sv-text-main)' }}>${Number(reg.default_float ?? 0).toFixed(2)}</td>
                  <td style={{ padding: '8px 12px' }}><ActiveDot active={reg.is_active} /></td>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleRename(reg)} style={btnStyle('ghost', 'xs')}>Rename</button>
                      <button onClick={() => handleFloat(reg)} style={btnStyle('ghost', 'xs')}>Float</button>
                      <button onClick={() => handleToggle(reg)} style={btnStyle(reg.is_active ? 'danger' : 'mint', 'xs')}>{reg.is_active ? 'Deactivate' : 'Reactivate'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LocationsView({ isAdvisor = false }: { isAdvisor?: boolean } = {}) {
  const [locations, setLocations] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; edit: any | null }>({ open: false, edit: null });
  const [form, setForm] = useState({ ...BLANK_LOC });
  const [saving, setSaving] = useState(false);
  const [registersFor, setRegistersFor] = useState<{ id: number; name: string } | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});

  // Load/reset targets whenever modal opens or changes
  useEffect(() => {
    if (!modal.open) { setTargets({}); return; }
    if (modal.edit?.id) {
      fetch(`/api/ims/locations/${modal.edit.id}/targets`)
        .then(r => r.json())
        .then(d => {
          const t: Record<string, string> = {};
          for (const [k, v] of Object.entries(d.targets ?? {})) t[k] = String(v);
          setTargets(t);
        })
        .catch(() => {});
    }
  }, [modal.open, modal.edit?.id]);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/ims/locations?includeDeletionStatus=1').then(r => r.json()).then(d => {
      if (d.success) setLocations(d.data);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url  = modal.edit ? `/api/ims/locations/${modal.edit.id}` : '/api/ims/locations';
      const method = modal.edit ? 'PUT' : 'POST';
      const result = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const locationId = modal.edit?.id ?? result.id;
      // Save daily sales targets
      const targetsPayload: Record<string, number> = {};
      for (const day of LOC_TARGET_DAYS) {
        const v = parseInt(targets[day] ?? '0', 10);
        if (v > 0) targetsPayload[day] = v;
      }
      await apiFetch(`/api/ims/locations/${locationId}/targets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: targetsPayload }),
      });
      load(); setModal({ open: false, edit: null });
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (l: any) => {
    if (!confirm(`Delete location "${l.name}"?`)) return;
    try { await apiFetch(`/api/ims/locations/${l.id}`, { method: 'DELETE' }); load(); }
    catch (e: any) { alert(e.message); }
  };

  const visibleLocations = locations.filter(location =>
    statusFilter === 'all' || (statusFilter === 'active' ? !!Number(location.is_active) : !Number(location.is_active)),
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sv-text-strong)', margin: 0, flex: 1 }}>Locations</h1>
        <select aria-label="Filter locations by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'active' | 'inactive' | 'all')} style={{ ...inputStyle, width: 130, marginBottom: 0 }}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        {!isAdvisor && <button onClick={() => { setForm({ ...BLANK_LOC }); setModal({ open: true, edit: null }); }} style={btnStyle('action')}>+ New Location</button>}
      </div>
      {loading ? <Spinner /> : (
        <ImsTable
          cols={['Name','Code','City','State','Active','']}
          rows={visibleLocations}
          background="var(--sv-bg-1)"
          headerBackground="var(--sv-bg-2)"
          columnWidths={[240, 140, 200, 120, 100, 230]}
          frozenColumnIndex={0}
          scrollClassName="locations-table-scroll"
          render={(l) => [
            <strong style={{ color: 'var(--sv-text-strong)' }}>{l.name}</strong>,
            l.code || '—', l.city || '—', l.state || '—',
            <ActiveDot active={l.is_active} />,
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setRegistersFor(registersFor?.id === l.id ? null : { id: l.id, name: l.name })} style={btnStyle('ghost', 'xs')}>Registers</button>
              {!isAdvisor && <button onClick={() => { setForm({ ...BLANK_LOC, ...l, manager_pin: '', clear_manager_pin: false }); setModal({ open: true, edit: l }); }} style={btnStyle('ghost', 'xs')}>Edit</button>}
              {!isAdvisor && l.can_delete && <button onClick={() => handleDelete(l)} style={btnStyle('danger', 'xs')}>Delete</button>}
            </div>,
          ]}
        />
      )}
      {registersFor && (
        <LocationRegistersPanel
          locationId={registersFor.id}
          locationName={registersFor.name}
          onClose={() => setRegistersFor(null)}
        />
      )}
      {modal.open && (
        <Modal title={modal.edit ? 'Edit Location' : 'New Location'} onClose={() => setModal({ open: false, edit: null })}>
          <form onSubmit={handleSubmit}>
            <Row2>
              <Field label="Name *"><input required value={form.name} onChange={sf('name')} style={inputStyle} /></Field>
              <Field label="Code"><input value={form.code} onChange={sf('code')} style={inputStyle} /></Field>
            </Row2>
            <Row2>
              <Field label="Address"><input value={form.address} onChange={sf('address')} style={inputStyle} /></Field>
              <Field label="Phone"><input value={(form as any).phone ?? ''} onChange={sf('phone')} style={inputStyle} placeholder="e.g. (02) 9000 0000" /></Field>
            </Row2>
            <Row3>
              <Field label="City"><input value={form.city} onChange={sf('city')} style={inputStyle} /></Field>
              <Field label="State"><input value={form.state} onChange={sf('state')} style={inputStyle} /></Field>
              <Field label="Postcode"><input value={form.postcode} onChange={sf('postcode')} style={inputStyle} /></Field>
            </Row3>
            <Row2>
              <Field label="Country"><input value={form.country} onChange={sf('country')} style={inputStyle} /></Field>
              <Field label="Active">
                <select value={form.is_active} onChange={sf('is_active')} style={inputStyle}>
                  <option value={1}>Yes</option><option value={0}>No</option>
                </select>
              </Field>
            </Row2>
            <Field label="POS Location Code" >
              <input value={(form as any).pos_location_code ?? ''} onChange={sf('pos_location_code' as any)} style={inputStyle} placeholder="e.g. MT-BOND-7K2P9X" maxLength={32} />
              <p style={{ margin: '4px 0 0', fontSize: '.75rem', color: 'var(--sv-text-dim)' }}>Entered once per POS device during setup. Identifies this branch and your business — use something long and unique (e.g. business-branch-random).</p>
            </Field>
            <Field label="Manager PIN">
              {(form as any).has_manager_pin && !(form as any).clear_manager_pin && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--sv-mint)' }}>✓ PIN is set</span>
                  <button type="button" onClick={() => setForm(p => ({ ...p, clear_manager_pin: true, manager_pin: '' }))} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(224,82,82,.5)', background: 'transparent', color: '#e05252', cursor: 'pointer' }}>Clear</button>
                </div>
              )}
              {(form as any).clear_manager_pin && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#e05252' }}>PIN will be cleared on save.</span>
                  <button type="button" onClick={() => setForm(p => ({ ...p, clear_manager_pin: false }))} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--sv-etch)', background: 'transparent', color: 'var(--sv-text-dim)', cursor: 'pointer' }}>Undo</button>
                </div>
              )}
              {!(form as any).clear_manager_pin && (
                <input type="password" maxLength={8} value={(form as any).manager_pin ?? ''} onChange={sf('manager_pin' as any)} style={inputStyle} placeholder={(form as any).has_manager_pin ? 'New PIN (leave blank to keep current)' : '4–8 digit PIN required to edit/delete POS transactions'} />
              )}
              <p style={{ margin: '4px 0 0', fontSize: '.75rem', color: 'var(--sv-text-dim)' }}>Required in POS to edit or delete a transaction from the current register session.</p>
            </Field>
            <Field label="Enabled Channels">
              <div style={{ display: 'flex', gap: '1.5rem', paddingTop: 4 }}>
                {[{ key: 'has_pos', label: 'POS' }, { key: 'has_wholesale', label: 'Wholesale' }, { key: 'has_online', label: 'Online' }].map(ch => (
                  <label key={ch.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.88rem', color: 'var(--sv-text-main)', cursor: 'pointer' }}>
                    <input type="checkbox"
                      checked={!!(form as any)[ch.key]}
                      onChange={e => setForm(f => ({ ...f, [ch.key]: e.target.checked ? 1 : 0 }))}
                      style={{ width: 15, height: 15, accentColor: 'var(--sv-action)' }} />
                    {ch.label}
                  </label>
                ))}
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '.75rem', color: 'var(--sv-text-dim)' }}>Which sales channels are active at this location.</p>
            </Field>
            <Field label="Daily Sales Targets ($)">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginTop: 4 }}>
                {LOC_TARGET_DAYS.map(day => (
                  <div key={day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{day}</span>
                    <input
                      type="number" min="0" step="1"
                      value={targets[day] ?? ''}
                      onChange={e => setTargets(p => ({ ...p, [day]: e.target.value }))}
                      placeholder="—"
                      style={{ ...inputStyle, textAlign: 'center', padding: '5px 2px', fontSize: 13, width: '100%', minWidth: 0 }}
                    />
                  </div>
                ))}
              </div>
              <p style={{ margin: '5px 0 0', fontSize: '.75rem', color: 'var(--sv-text-dim)' }}>Whole dollar amounts. Leave blank = no target shown in POS for that day.</p>
            </Field>
            <FormActions onCancel={() => setModal({ open: false, edit: null })} saving={saving} isEdit={!!modal.edit} createLabel="Save" />
          </form>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Products View
// ─────────────────────────────────────────────────────────────────────────────

interface VariantRow {
  _tempId: string;
  variant_id?: string;
  option1_value: string;
  option2_value: string;
  option3_value: string;
  sku: string;
  barcode: string;
  cost_aud: string;
  price_rrp: string;
  price_rrp_sale: string;
  discount_start_date: string;
  discount_end_date: string;
  weight_kg: string;
  length_mm: string;
  width_mm: string;
  height_mm: string;
  price_wholesale: string;
  pack_size: string;
  is_active: number;
  foreignCosts: Record<string, string>; // e.g. { USD: '10.50', THB: '380' }
  _delete?: boolean;
}
interface OptionSet { name: string; values: string; }
interface OpeningStockValue { quantity: string; minQty: string; reorderQty: string }
interface PendingProductSave { productId: string; requestToken: string }

const COUNTRY_OPTIONS = getCountryOptions();
const BLANK_PRODUCT = {
  name: '', description: '', product_type: '', brand: '', tags: '', category: '', subcategory: '', is_active: 1,
  is_stock_item: 1, uses_builds: 0, base_sku: '', customs_description: '', hs_code: '', country_of_origin: '',
  is_dangerous_or_restricted: 0,
};

const blankRow = (): VariantRow => ({
  _tempId: Math.random().toString(36).slice(2, 10),
  option1_value: '', option2_value: '', option3_value: '',
  sku: '', barcode: '', cost_aud: '', price_rrp: '',
  price_wholesale: '', pack_size: '',
  price_rrp_sale: '', discount_start_date: '', discount_end_date: '',
  weight_kg: '', length_mm: '', width_mm: '', height_mm: '', is_active: 1, foreignCosts: {},
});

const PAGE_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Import Line Items Modal (shared by PO / SO / BT)
// ─────────────────────────────────────────────────────────────────────────────
type ImportMode = 'scan' | 'paste';

function ImportLineItemsModal({
  variants,
  priceFn,
  lineFactory,
  onImport,
  onClose,
}: {
  variants: any[];
  priceFn: (v: any) => number;
  lineFactory: (v: any, qty: number, price: number) => any;
  onImport: (items: any[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ImportMode>('scan');
  const [scanText, setScanText] = useState('');
  const [scanOverrides, setScanOverrides] = useState<Record<string, { qty: number; price: number }>>({});
  const [pasteText, setPasteText] = useState('');

  const lookupVariant = (code: string) => {
    const c = code.trim().toLowerCase();
    return variants.find(v =>
      (v.barcode && v.barcode.toLowerCase() === c) ||
      (v.sku && v.sku.toLowerCase() === c)
    );
  };

  // Tally barcodes: count occurrences per line, merge duplicates
  const scanTally = (() => {
    const counts: Record<string, { variant: any; count: number }> = {};
    scanText.split('\n').map(l => l.trim()).filter(Boolean).forEach(code => {
      const v = lookupVariant(code);
      if (v) {
        if (counts[v.variant_id]) counts[v.variant_id].count += 1;
        else counts[v.variant_id] = { variant: v, count: 1 };
      }
    });
    return counts;
  })();

  const scanUnmatched = scanText.split('\n').map(l => l.trim()).filter(l => l && !lookupVariant(l));

  const scanItems = Object.entries(scanTally).map(([vid, { variant: v, count }]) => ({
    variant: v,
    qty: scanOverrides[vid]?.qty ?? count,
    price: scanOverrides[vid]?.price ?? priceFn(v),
  }));

  const parsePaste = () =>
    pasteText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const parts = line.split('\t');
      const code = parts[0]?.trim() ?? '';
      const qty = parseFloat(parts[1]?.trim() || '1') || 1;
      const rawPrice = parseFloat(parts[2]?.trim() || '');
      const variant = lookupVariant(code);
      const price = isNaN(rawPrice) ? (variant ? priceFn(variant) : 0) : rawPrice;
      return { code, variant, qty, price };
    });

  const handleImport = () => {
    let newItems: any[] = [];
    if (mode === 'scan') {
      newItems = scanItems.map(({ variant: v, qty, price }) => lineFactory(v, qty, price));
    } else {
      newItems = parsePaste().filter(r => r.variant).map(r => lineFactory(r.variant!, r.qty, r.price));
    }
    if (newItems.length === 0) { alert('No valid items to import.'); return; }
    onImport(newItems);
    onClose();
  };

  const pasteRows = parsePaste();
  const pasteValid = pasteRows.filter(r => r.variant).length;
  const importCount = mode === 'scan' ? scanItems.length : pasteValid;

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 20px', fontSize: 13, fontWeight: 600, border: 'none',
    cursor: 'pointer', transition: 'all .15s',
    background: active ? 'var(--sv-action, #6366f1)' : 'var(--sv-bg-1)',
    color: active ? '#fff' : 'var(--sv-text-dim)',
  });

  return (
    <Modal title="Import Line Items" onClose={onClose}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', marginBottom: 20, border: '1px solid var(--sv-etch)', borderRadius: 6, overflow: 'hidden', width: 'fit-content' }}>
        <button type="button" onClick={() => setMode('scan')} style={toggleStyle(mode === 'scan')}>📷 Barcode Scan</button>
        <button type="button" onClick={() => setMode('paste')} style={toggleStyle(mode === 'paste')}>📋 Paste / Tab-delimited</button>
      </div>

      {mode === 'scan' && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginBottom: 6 }}>
            Paste or scan barcodes/SKUs — one per line. Duplicates are tallied automatically.
          </div>
          <textarea
            value={scanText}
            onChange={e => { setScanText(e.target.value); setScanOverrides({}); }}
            placeholder={'9312345000012\n9312345000012\n9312345000029'}
            rows={8}
            style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
            autoFocus
          />
          {scanItems.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 10, marginBottom: 6, border: '1px solid var(--sv-etch)', borderRadius: 6, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)' }}>
                  {['Product / SKU', 'Scanned', 'Qty', 'Unit Price', ''].map(h => (
                    <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scanItems.map(({ variant: v, qty, price }) => {
                  const scannedCount = scanTally[v.variant_id]?.count ?? 0;
                  return (
                    <tr key={v.variant_id} style={{ borderTop: '1px solid var(--sv-etch)' }}>
                      <td style={{ padding: '4px 8px' }}>
                        <div style={{ fontWeight: 500 }}>{v.product_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>{[v.sku, v.barcode].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={{ padding: '4px 8px', width: 60, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 12 }}>{scannedCount}×</td>
                      <td style={{ padding: '4px 4px', width: 72 }}>
                        <input type="number" min="0.0001" step="any" value={qty}
                          onChange={e => setScanOverrides(prev => ({ ...prev, [v.variant_id]: { qty: parseFloat(e.target.value) || 0, price: prev[v.variant_id]?.price ?? priceFn(v) } }))}
                          style={{ ...inputStyle, fontSize: 12 }} />
                      </td>
                      <td style={{ padding: '4px 4px', width: 88 }}>
                        <input type="number" min="0" step="0.01" value={price}
                          onChange={e => setScanOverrides(prev => ({ ...prev, [v.variant_id]: { qty: prev[v.variant_id]?.qty ?? scannedCount, price: parseFloat(e.target.value) || 0 } }))}
                          style={{ ...inputStyle, fontSize: 12 }} />
                      </td>
                      <td style={{ padding: '4px 4px', width: 28 }}>
                        <button type="button"
                          onClick={() => { setScanText(prev => prev.split('\n').filter(l => { const vv = lookupVariant(l.trim()); return !vv || vv.variant_id !== v.variant_id; }).join('\n')); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sv-red)', fontSize: 16 }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {scanUnmatched.length > 0 && (
            <div style={{ background: 'rgba(239,68,68,.1)', borderRadius: 6, padding: '8px 12px', marginTop: 6, fontSize: 12, color: 'var(--sv-red)' }}>
              ⚠ Unrecognised ({scanUnmatched.length}): {scanUnmatched.slice(0, 10).join(', ')}{scanUnmatched.length > 10 ? ` +${scanUnmatched.length - 10} more` : ''}
            </div>
          )}
        </div>
      )}

      {mode === 'paste' && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', marginBottom: 6 }}>
            Paste tab-delimited rows: <code style={{ background: 'var(--sv-bg-2)', padding: '1px 4px', borderRadius: 3 }}>SKU or Barcode [Tab] Qty [Tab] Price (optional)</code>
          </div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={'ABC123\t2\t15.00\nDEF456\t1'}
            rows={8}
            style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
            autoFocus
          />
          {pasteRows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 10, marginBottom: 6, border: '1px solid var(--sv-etch)', borderRadius: 6, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: 'var(--sv-bg-2)', borderBottom: '1px solid var(--sv-etch)' }}>
                  {['Code', 'Product', 'Qty', 'Price', ''].map(h => (
                    <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--sv-text-dim)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pasteRows.map((row, idx) => (
                  <tr key={idx} style={{ borderTop: '1px solid var(--sv-etch)', opacity: row.variant ? 1 : 0.5 }}>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 12 }}>{row.code}</td>
                    <td style={{ padding: '4px 8px' }}>
                      {row.variant
                        ? <span>{row.variant.product_name}{row.variant.sku ? <span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}> — {row.variant.sku}</span> : null}</span>
                        : <span style={{ color: 'var(--sv-red)' }}>Not found — will skip</span>}
                    </td>
                    <td style={{ padding: '4px 8px', width: 60 }}>{row.qty}</td>
                    <td style={{ padding: '4px 8px', width: 80 }}>{row.price.toFixed(2)}</td>
                    <td style={{ padding: '4px 8px', width: 60, textAlign: 'center' }}>
                      {row.variant
                        ? <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 600 }}>✓</span>
                        : <span style={{ color: 'var(--sv-red)', fontSize: 11, fontWeight: 600 }}>✗</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button type="button" onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
        <button type="button" onClick={handleImport} style={btnStyle('action')}
          disabled={(mode === 'scan' ? scanItems.length : pasteValid) === 0}>
          Import {mode === 'scan' ? scanItems.length : pasteValid} item{(mode === 'scan' ? scanItems.length : pasteValid) !== 1 ? 's' : ''}
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Import Products Modal
// ─────────────────────────────────────────────────────────────────────────────

const IMPORT_FX_COST_HEADERS = ['Cost_USD', 'Cost_EUR', 'Cost_GBP', 'Cost_THB', 'Cost_CNY', 'Cost_JPY'] as const;

const IMPORT_BASE_HEADERS = [
  'Product_Name','Product_SKU','Barcode','Description','Brand','Supplier','Product_Type',
  'Category','Subcategory','Website_Title','Allow_Indent_Wholesale_Orders','Tags','Online','Pack_Size',
  'Option1_Name','Option1_Value','Option2_Name','Option2_Value','Option3_Name','Option3_Value',
  'RRP','price_wholesale','Cost_AUD','Cost_USD','Cost_EUR','Cost_GBP','Cost_THB','Cost_CNY','Cost_JPY','Weight_KG',
];

type ImportProductsStage = 'paste' | 'prompts' | 'review' | 'importing' | 'done';

interface ParsedImportRow {
  raw: Record<string, string>;
  product_name: string;
  sku: string;
  action: 'new_product' | 'new_variant' | 'update' | 'error';
  errorMsg?: string;
  existing_variant_id?: string;
  existing_product_id?: string;
  changedFields?: string[];
}

function ImportProductsModal({
  products,
  brands,
  contacts,
  onClose,
  onDone,
}: {
  products: any[];
  brands: { id: number; name: string }[];
  contacts: { id: number; name: string; type: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<ImportProductsStage>('paste');
  const [pasteText, setPasteText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  const [unknownBrands, setUnknownBrands] = useState<string[]>([]);
  const [unknownSuppliers, setUnknownSuppliers] = useState<string[]>([]);
  const [promptQueue, setPromptQueue] = useState<Array<{ kind: 'brand' | 'supplier'; name: string }>>([]);
  const [currentPrompt, setCurrentPrompt] = useState<{ kind: 'brand' | 'supplier'; name: string } | null>(null);
  const [promptChoice, setPromptChoice] = useState<'new' | 'existing'>('new');
  const [promptSelected, setPromptSelected] = useState('');
  // Maps unknown name → resolved name (after prompts)
  const [brandResolutions, setBrandResolutions] = useState<Record<string, string>>({});
  const [supplierResolutions, setSupplierResolutions] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [headersCopied, setHeadersCopied] = useState(false);

  // Per-location Zone/Bin/Min Qty/Reorder Qty columns are appended to the template headers.
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const { settings: importSettings } = useImsSettings();
  const showZoneBin   = importSettings.use_zones_bins  !== 'no';
  const showFxCosts   = importSettings.use_foreign_currencies !== 'no';

  // Full template header list: optional category cols + base columns + per-location stock columns.
  const templateHeaders = useMemo(() => {
    const baseHeaders = showFxCosts
      ? IMPORT_BASE_HEADERS
      : IMPORT_BASE_HEADERS.filter(h => !(IMPORT_FX_COST_HEADERS as readonly string[]).includes(h));
    const perLoc: string[] = [];
    for (const loc of locations) {
      if (showZoneBin) {
        perLoc.push(`${loc.name} - Zone`, `${loc.name} - Bin`);
      }
      perLoc.push(`${loc.name} - Min Qty`, `${loc.name} - Reorder Qty`);
    }
    return [...baseHeaders, ...perLoc];
  }, [locations, showZoneBin, showFxCosts]);

  // Normalized header string → { location_id, field } for parsing per-location columns.
  const locHeaderMap = useMemo(() => {
    const m = new Map<string, { location_id: number; field: 'zone' | 'bin' | 'min_qty' | 'reorder_qty' }>();
    for (const loc of locations) {
      const base = loc.name.trim().toLowerCase();
      if (showZoneBin) {
        m.set(`${base} - zone`, { location_id: loc.id, field: 'zone' });
        m.set(`${base} - bin`,  { location_id: loc.id, field: 'bin' });
      }
      m.set(`${base} - min qty`,     { location_id: loc.id, field: 'min_qty' });
      m.set(`${base} - reorder qty`, { location_id: loc.id, field: 'reorder_qty' });
    }
    return m;
  }, [locations, showZoneBin]);

  // Load locations — sorted with default warehouse first, then alphabetical
  useEffect(() => {
    fetch('/api/ims/locations').then(r => r.json()).then(d => {
      if (!d.success) return;
      const defaultId = Number(importSettings.default_warehouse_location_id ?? 0);
      const sorted = (d.data ?? []).slice().sort((a: any, b: any) => {
        if (a.id === defaultId) return -1;
        if (b.id === defaultId) return 1;
        return a.name.localeCompare(b.name);
      });
      setLocations(sorted);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importSettings.default_warehouse_location_id]);

  // Pre-fill / refresh the header row whenever the template changes — but only while
  // the user hasn't pasted any data rows yet (textarea holds ≤ 1 line).
  useEffect(() => {
    const line = templateHeaders.join('\t');
    setPasteText(prev => {
      const lines = prev.split('\n').filter(l => l.trim());
      return lines.length <= 1 ? line : prev;
    });
  }, [templateHeaders]);

  const copyTemplateHeaders = async () => {
    try {
      await navigator.clipboard.writeText(templateHeaders.join('\t'));
      setHeadersCopied(true);
      window.setTimeout(() => setHeadersCopied(false), 1800);
    } catch {
      alert('Could not copy the CSV titles. Select the first row and copy it manually.');
    }
  };

  const normStr = (s: string) => (s || '').trim().toLowerCase();

  const rawValue = (raw: Record<string, string>, ...keys: string[]) => {
    for (const key of keys) {
      const value = raw[key];
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const parseImportFlag = (value: string | undefined): number | undefined => {
    if (value == null || value === '') return undefined;
    const v = value.trim().toLowerCase();
    if (['1', 'yes', 'y', 'true', 'on', 'allow', 'allowed', 'enabled'].includes(v)) return 1;
    if (['0', 'no', 'n', 'false', 'off', 'disallow', 'disabled'].includes(v)) return 0;
    return undefined;
  };

  const parseAndClassify = (): ParsedImportRow[] => {
    const lines = pasteText.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
    if (lines.length < 2) return [];

    // Detect if first line is headers (contains known header keywords, no purely numeric values)
    const firstCells = lines[0].split('\t');
    const headerSet = new Set(templateHeaders.map(h => h.toLowerCase()));
    const isHeaderLine = firstCells.some(c => headerSet.has(c.trim().toLowerCase()));
    const headers = isHeaderLine
      ? firstCells.map(h => h.trim().toLowerCase())
      : templateHeaders.map(h => h.toLowerCase());
    // Filter out any duplicate/extra header rows that sneak into the data
    // (happens when user pastes header+data into a textarea that already has the header)
    const looksLikeHeader = (line: string) =>
      line.split('\t').filter(c => headerSet.has(c.trim().toLowerCase())).length >= 2;
    const dataLines = (isHeaderLine ? lines.slice(1) : lines).filter(l => !looksLikeHeader(l));

    // Build variant lookup map from products
    const variantBySkuMap = new Map<string, { variant: any; product: any }>();
    const productByNameMap = new Map<string, any>();
    const productByBaseSkuMap = new Map<string, any>(); // keyed by base_sku OR style_code
    for (const p of products) {
      productByNameMap.set(normStr(p.name), p);
      if (p.base_sku)   productByBaseSkuMap.set(normStr(p.base_sku), p);
      if (p.style_code) productByBaseSkuMap.set(normStr(p.style_code), p); // fallback
      for (const v of (p.variants || [])) {
        if (v.sku) variantBySkuMap.set(normStr(v.sku), { variant: v, product: p });
      }
    }

    const brandNames = new Set(brands.map(b => normStr(b.name)));
    const supplierNames = new Set(contacts.filter(c => c.type === 'supplier' || c.type === 'both').map(c => normStr(c.name)));

    const foundUnknownBrands = new Set<string>();
    const foundUnknownSuppliers = new Set<string>();

    // Pre-pass: cache product-level fields from the first row of each Product_SKU group so
    // subsequent variant rows can omit Product_Name, Brand, Supplier, Description etc.
    const batchProductFields = new Map<string, Record<string, string>>();
    for (const dline of dataLines) {
      const dcells = dline.split('\t');
      const draw: Record<string, string> = {};
      headers.forEach((h, i) => { draw[h] = (dcells[i] ?? '').trim(); });
      const dps = normStr(draw['product_sku'] || '');
      if (dps && !batchProductFields.has(dps) && (draw['product_name'] || '').trim()) {
        batchProductFields.set(dps, draw);
      }
    }

    const rows: ParsedImportRow[] = dataLines.map(line => {
      const cells = line.split('\t');
      const raw: Record<string, string> = {};
      headers.forEach((h, i) => { raw[h] = (cells[i] ?? '').trim(); });

      const product_sku = raw['product_sku'] || ''; // Product_SKU grouping key

      // Inherit missing product-level fields from the first row with the same Product_SKU
      const cached = product_sku ? batchProductFields.get(normStr(product_sku)) : undefined;
      if (cached) {
        for (const field of ['product_name','description','product_type','brand','supplier','tags','category','subcategory','sub category','subcateogry','website_title','website title','allow_indent_wholesale_orders','allow indent wholesale orders','allow_indent_wholesale','allow indent wholesale']) {
          if (!raw[field] && cached[field]) raw[field] = cached[field];
        }
      }

      const product_name = raw['product_name'] || '';
      const sku = deriveVariantSku(product_sku, [raw['option1_value'], raw['option2_value'], raw['option3_value']]);
      const brand = raw['brand'] || '';
      const supplier = raw['supplier'] || '';

      if (!product_sku) {
        return { raw, product_name, sku, action: 'error' as const, errorMsg: 'Missing Product_SKU' };
      }
      if (!product_name) {
        return { raw, product_name, sku, action: 'error' as const, errorMsg: 'Missing Product_Name' };
      }

      if (brand && !brandNames.has(normStr(brand))) foundUnknownBrands.add(brand.trim());
      if (supplier && !supplierNames.has(normStr(supplier))) foundUnknownSuppliers.add(supplier.trim());

      let action: ParsedImportRow['action'];
      let existing_variant_id: string | undefined;
      let existing_product_id: string | undefined;
      let changedFields: string[] = [];

      const resolved = resolveImportMatch({
        sku,
        barcode: raw['barcode'] ?? '',
        product_sku: raw['product_sku'] ?? '',
        product_name: raw['product_name'] ?? '',
        variantBySkuMap,
        productByNameMap,
        productByBaseSkuMap,
      });

      action = resolved.action;
      existing_variant_id = resolved.existing_variant_id;
      existing_product_id = resolved.existing_product_id;

      if (action === 'update' && existing_variant_id) {
        const match = variantBySkuMap.get(normStr(sku)) || Array.from(variantBySkuMap.values()).find(({ variant }) => variant.variant_id === existing_variant_id);
        if (match) {
          const v = match.variant;
          const p = match.product;
          const numOrNull = (s: string | undefined) => (s == null || s === '') ? null : Number(s);
          if (raw['rrp'] != null && raw['rrp'] !== '' && numOrNull(raw['rrp']) !== (v.price_rrp ?? null)) changedFields.push('RRP');
          if (raw['cost_aud'] != null && raw['cost_aud'] !== '' && numOrNull(raw['cost_aud']) !== (v.cost_aud ?? null)) changedFields.push('Cost');
          if (raw['price_wholesale'] != null && raw['price_wholesale'] !== '' && numOrNull(raw['price_wholesale']) !== (v.price_wholesale ?? null)) changedFields.push('Wholesale');
          if (raw['weight_kg'] != null && raw['weight_kg'] !== '' && numOrNull(raw['weight_kg']) !== (v.weight_kg ?? null)) changedFields.push('Weight');
          if (raw['barcode'] != null && raw['barcode'] !== '' && raw['barcode'] !== (v.barcode ?? '')) changedFields.push('Barcode');
          if (raw['brand'] != null && raw['brand'] !== '' && raw['brand'] !== (p.brand ?? '')) changedFields.push('Brand');
          const websiteTitle = rawValue(raw, 'website_title', 'website title');
          if (websiteTitle != null && websiteTitle !== '' && websiteTitle !== (p.website_title ?? '')) changedFields.push('Website Title');
          const allowIndent = parseImportFlag(rawValue(raw, 'allow_indent_wholesale_orders', 'allow indent wholesale orders', 'allow_indent_wholesale', 'allow indent wholesale'));
          if (allowIndent !== undefined && allowIndent !== Number(p.allow_indent_wholesale ?? 0)) changedFields.push('Indent Wholesale');
          const category = rawValue(raw, 'category');
          if (category != null && category !== '' && category !== (p.category ?? '')) changedFields.push('Category');
          const subcategory = rawValue(raw, 'subcategory', 'sub category', 'subcateogry');
          if (subcategory != null && subcategory !== '' && subcategory !== (p.subcategory ?? '')) changedFields.push('Subcategory');
        }
      }

      return { raw, product_name, sku, action, existing_variant_id, existing_product_id, changedFields };
    }).filter(r => r.product_name || r.raw['product_sku'] || r.action === 'error');

    // Post-pass: when multiple rows share the same product_sku and all would create a
    // new product (product doesn't exist in DB yet), keep only the first as new_product
    // and reclassify the rest as new_variant. The API's createdProductIds map links them.
    const batchSeenSkus = new Map<string, true>();
    for (const row of rows) {
      if (row.action === 'new_product') {
        const ps = normStr(row.raw['product_sku'] || '');
        if (ps) {
          if (batchSeenSkus.has(ps)) {
            (row as any).action = 'new_variant';
          } else {
            batchSeenSkus.set(ps, true);
          }
        }
      }
    }

    setUnknownBrands([...foundUnknownBrands]);
    setUnknownSuppliers([...foundUnknownSuppliers]);
    return rows;
  };

  const handleNext = () => {
    const rows = parseAndClassify();
    if (rows.length === 0) { alert('No data rows found. Paste your data below the header row.'); return; }
    setParsedRows(rows);

    // Re-parse to get unknowns (already set in parseAndClassify via state)
    // Build prompt queue after short delay to get updated state
    setTimeout(() => {
      setStage('prompts');
    }, 0);
  };

  // After parse, build prompt queue once in prompts stage
  useEffect(() => {
    if (stage !== 'prompts') return;
    const queue: Array<{ kind: 'brand' | 'supplier'; name: string }> = [
      ...unknownBrands.map(n => ({ kind: 'brand' as const, name: n })),
      ...unknownSuppliers.map(n => ({ kind: 'supplier' as const, name: n })),
    ];
    if (queue.length === 0) {
      setStage('review');
      return;
    }
    setPromptQueue(queue.slice(1));
    setCurrentPrompt(queue[0]);
    setPromptChoice('new');
    setPromptSelected(queue[0].kind === 'brand' ? brands[0]?.name ?? '' : contacts.find(c => c.type === 'supplier' || c.type === 'both')?.name ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const handlePromptConfirm = () => {
    if (!currentPrompt) return;
    if (currentPrompt.kind === 'brand') {
      setBrandResolutions(prev => ({ ...prev, [currentPrompt.name]: promptChoice === 'new' ? currentPrompt.name : promptSelected }));
    } else {
      setSupplierResolutions(prev => ({ ...prev, [currentPrompt.name]: promptChoice === 'new' ? currentPrompt.name : promptSelected }));
    }
    if (promptQueue.length === 0) {
      setCurrentPrompt(null);
      setStage('review');
    } else {
      const [next, ...rest] = promptQueue;
      setCurrentPrompt(next);
      setPromptQueue(rest);
      setPromptChoice('new');
      setPromptSelected(next.kind === 'brand' ? brands[0]?.name ?? '' : contacts.find(c => c.type === 'supplier' || c.type === 'both')?.name ?? '');
    }
  };

  const buildApiRows = () => {
    return parsedRows.map(r => {
      if (r.action === 'error') return { ...r.raw, action: 'error' };
      const raw = r.raw;
      const numOrNull = (s: string | undefined) => (s == null || s === '') ? null : Number(s);

      // Build cost_foreign from Cost_XXX columns
      const foreignCosts: Record<string, number> = {};
      for (const key of Object.keys(raw)) {
        const m = key.match(/^cost_([a-z]{3})$/);
        if (m && m[1] !== 'aud' && raw[key] !== '') {
          foreignCosts[m[1].toUpperCase()] = Number(raw[key]);
        }
      }

      const resolvedBrand = raw['brand'] ? (brandResolutions[raw['brand']] ?? raw['brand']) : '';
      const resolvedSupplier = raw['supplier'] ? (supplierResolutions[raw['supplier']] ?? raw['supplier']) : '';
      const websiteTitle = rawValue(raw, 'website_title', 'website title');
      const allowIndentWholesale = parseImportFlag(rawValue(raw, 'allow_indent_wholesale_orders', 'allow indent wholesale orders', 'allow_indent_wholesale', 'allow indent wholesale'));
      const category = rawValue(raw, 'category');
      const subcategory = rawValue(raw, 'subcategory', 'sub category', 'subcateogry');

      // Build per-location stock overrides from the appended location columns.
      const location_stock: Array<{ location_id: number; zone?: string; bin?: string; min_qty?: number; reorder_qty?: number }> = [];
      for (const loc of locations) {
        const base = loc.name.trim().toLowerCase();
        const entry: { location_id: number; zone?: string; bin?: string; min_qty?: number; reorder_qty?: number } = { location_id: loc.id };
        let has = false;
        if (showZoneBin) {
          const z = raw[`${base} - zone`]; if (z !== undefined && z !== '') { entry.zone = z; has = true; }
          const b = raw[`${base} - bin`];  if (b !== undefined && b !== '') { entry.bin  = b; has = true; }
        }
        const mn = raw[`${base} - min qty`];     if (mn !== undefined && mn !== '' && !isNaN(Number(mn))) { entry.min_qty = Number(mn); has = true; }
        const rq = raw[`${base} - reorder qty`]; if (rq !== undefined && rq !== '' && !isNaN(Number(rq))) { entry.reorder_qty = Number(rq); has = true; }
        if (has) location_stock.push(entry);
      }

      return {
        action: r.action,
        product_name: r.product_name,
        description: raw['description'] || undefined,
        product_type: raw['product_type'] || undefined,
        brand: resolvedBrand || undefined,
        supplier_name: resolvedSupplier || undefined,
        tags: raw['tags'] || undefined,
        base_sku: raw['product_sku'] || undefined,
        style_code: undefined,
        category: category || undefined,
        subcategory: subcategory || undefined,
        website_title: websiteTitle || undefined,
        allow_indent_wholesale: allowIndentWholesale,
        is_online: raw['online'] != null && raw['online'] !== '' ? (raw['online'] === '1' || raw['online'].toLowerCase() === 'yes' ? 1 : 0) : undefined,
        sku: deriveVariantSku(raw['product_sku'], [raw['option1_value'], raw['option2_value'], raw['option3_value']]),
        barcode: raw['barcode'] || undefined,
        cost_aud: numOrNull(raw['cost_aud']),
        price_rrp: numOrNull(raw['rrp']),
        price_wholesale: numOrNull(raw['price_wholesale']),
        weight_kg: numOrNull(raw['weight_kg']),
        pack_size: numOrNull(raw['pack_size']),
        option1_name: raw['option1_name'] || undefined,
        option1_value: raw['option1_value'] || undefined,
        option2_name: raw['option2_name'] || undefined,
        option2_value: raw['option2_value'] || undefined,
        option3_name: raw['option3_name'] || undefined,
        option3_value: raw['option3_value'] || undefined,
        cost_foreign: Object.keys(foreignCosts).length ? JSON.stringify(foreignCosts) : undefined,
        location_stock: location_stock.length ? location_stock : undefined,
        existing_variant_id: r.existing_variant_id,
        existing_product_id: r.existing_product_id,
      };
    });
  };

  const handleConfirm = async () => {
    setImporting(true);
    setStage('importing');
    try {
      const autoCreateBrands = Object.entries(brandResolutions).filter(([, v]) => v === Object.keys(brandResolutions).find(k => brandResolutions[k] === v) || unknownBrands.includes(v)).map(([k, v]) => v === k ? k : '').filter(Boolean);
      // Simpler: brands to create are those where choice was 'new' (stored as same key=value)
      const newBrands = Object.entries(brandResolutions).filter(([k, v]) => k === v).map(([k]) => k);
      const newSuppliers = Object.entries(supplierResolutions).filter(([k, v]) => k === v).map(([k]) => k);

      const res = await fetch('/api/ims/products/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: buildApiRows(),
          autoCreateBrands: newBrands,
          autoCreateSuppliers: newSuppliers,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Import failed');
      setResult({ created: data.created, updated: data.updated, skipped: data.skipped });
      setStage('done');
      onDone();
    } catch (e: any) {
      alert(e.message);
      setStage('review');
    } finally {
      setImporting(false);
    }
  };

  const actionBadge = (action: ParsedImportRow['action']) => {
    const styles: Record<string, React.CSSProperties> = {
      new_product: { background: 'rgba(34,197,94,.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,.3)' },
      new_variant: { background: 'rgba(59,130,246,.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,.3)' },
      update: { background: 'rgba(234,179,8,.15)', color: '#facc15', border: '1px solid rgba(234,179,8,.3)' },
      error: { background: 'rgba(239,68,68,.15)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)' },
    };
    const labels = { new_product: 'New Product', new_variant: 'New Variant', update: 'Update', error: 'Error' };
    return (
      <span style={{ ...styles[action], padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {labels[action]}
      </span>
    );
  };

  const newCount = parsedRows.filter(r => r.action === 'new_product' || r.action === 'new_variant').length;
  const updateCount = parsedRows.filter(r => r.action === 'update').length;
  const errorCount = parsedRows.filter(r => r.action === 'error').length;

  const supplierContacts = contacts.filter(c => c.type === 'supplier' || c.type === 'both');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.7)' }}>
      <div style={{ background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 14, padding: 28, width: 900, maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--sv-text-strong)', flex: 1 }}>Import Products</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--sv-text-dim)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Stage: paste */}
        {stage === 'paste' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, flex: '1 1 420px', fontSize: 13, color: 'var(--sv-text-dim)', lineHeight: 1.6 }}>
                The field headers are pre-filled below. <strong style={{ color: 'var(--sv-text-main)' }}>Copy them into Excel or Google Sheets</strong>, fill your data in the rows below the headers, then paste everything back here.
              </p>
              <button type="button" onClick={copyTemplateHeaders} style={{ ...btnStyle('secondary', 'sm'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ClipboardCopy size={14} aria-hidden="true" /> {headersCopied ? 'Copied' : 'Copy CSV titles'}
              </button>
            </div>
            <div style={{ margin: '4px 0 8px', padding: '10px 14px', background: 'var(--sv-bg-2)', borderRadius: 8, border: '1px solid var(--sv-etch)', fontSize: 12, color: 'var(--sv-text-dim)', lineHeight: 1.7 }}>
              <strong style={{ color: 'var(--sv-text-main)' }}>Key columns:</strong><br />
              <strong>Product_SKU</strong> — Required. It groups variants under the same product and becomes the SKU for a single-variant product (e.g. <code style={{ fontFamily: 'monospace', background: 'var(--sv-bg-0)', padding: '1px 4px', borderRadius: 3 }}>MT-RCAK</code>). Variant SKUs are generated from Product_SKU and option values in order, such as <code style={{ fontFamily: 'monospace', background: 'var(--sv-bg-0)', padding: '1px 4px', borderRadius: 3 }}>MT-RCAK-S-Navy</code>.{' '}
              <strong>Product_Name</strong> — Required on the first row for each Product_SKU; later rows in that group inherit it.{' '}
              <strong>Category</strong> / <strong>Subcategory</strong> and <strong>Website_Title</strong> are product-level fields. <strong>Allow_Indent_Wholesale_Orders</strong> accepts Yes/No or 1/0.{' '}
              <br /><strong>{showZoneBin ? 'Zone, Bin, Min Qty and Reorder Qty' : 'Min Qty and Reorder Qty'}</strong>{' — '}per location columns saved against each location’s stock. The default warehouse location appears first.
              <br /><strong>Variant Options</strong>{' — '}Use <em>Option1_Name</em> / <em>Option1_Value</em> to define what makes each row a distinct variant. For example, set <em>Option1_Name</em> to <code style={{ fontFamily: 'monospace', background: 'var(--sv-bg-0)', padding: '1px 4px', borderRadius: 3 }}>Size</code> and <em>Option1_Value</em> to <code style={{ fontFamily: 'monospace', background: 'var(--sv-bg-0)', padding: '1px 4px', borderRadius: 3 }}>S</code>, <code style={{ fontFamily: 'monospace', background: 'var(--sv-bg-0)', padding: '1px 4px', borderRadius: 3 }}>M</code>, or <code style={{ fontFamily: 'monospace', background: 'var(--sv-bg-0)', padding: '1px 4px', borderRadius: 3 }}>L</code> on successive rows that all share the same <em>Product_SKU</em>. Use Option2 / Option3 for additional dimensions such as Colour.
            </div>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%', minHeight: 220, fontFamily: 'monospace', fontSize: 12,
                background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8,
                color: 'var(--sv-text-main)', padding: 12, resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
              <button onClick={handleNext} style={btnStyle('action')}>Next: Preview →</button>
            </div>
          </>
        )}

        {/* Stage: prompts */}
        {stage === 'prompts' && currentPrompt && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--sv-text-strong)' }}>
              Unknown {currentPrompt.kind === 'brand' ? 'Brand' : 'Supplier'}
            </h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--sv-text-dim)' }}>
              <strong style={{ color: 'var(--sv-text-main)' }}>"{currentPrompt.name}"</strong> is not in your {currentPrompt.kind} list.
              {promptQueue.length > 0 && <span style={{ marginLeft: 8, color: 'var(--sv-text-dim)', fontSize: 12 }}>({promptQueue.length} more to resolve)</span>}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8, border: `1px solid ${promptChoice === 'new' ? 'var(--sv-action)' : 'var(--sv-etch)'}`, background: promptChoice === 'new' ? 'rgba(37,99,235,.08)' : 'transparent' }}>
                <input type="radio" checked={promptChoice === 'new'} onChange={() => setPromptChoice('new')} style={{ accentColor: 'var(--sv-action)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Add "{currentPrompt.name}" as a new {currentPrompt.kind}</div>
                  <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>Creates it in the {currentPrompt.kind} list during import</div>
                </div>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '10px 12px', borderRadius: 8, border: `1px solid ${promptChoice === 'existing' ? 'var(--sv-action)' : 'var(--sv-etch)'}`, background: promptChoice === 'existing' ? 'rgba(37,99,235,.08)' : 'transparent' }}>
                <input type="radio" checked={promptChoice === 'existing'} onChange={() => setPromptChoice('existing')} style={{ accentColor: 'var(--sv-action)', marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Use an existing {currentPrompt.kind} instead</div>
                  <select
                    value={promptSelected}
                    onChange={e => { setPromptChoice('existing'); setPromptSelected(e.target.value); }}
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 6, color: 'var(--sv-text-main)', fontSize: 13 }}
                  >
                    {currentPrompt.kind === 'brand'
                      ? brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)
                      : supplierContacts.map(c => <option key={c.id} value={c.name}>{c.name}</option>)
                    }
                  </select>
                </div>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={onClose} style={btnStyle('ghost')}>Cancel</button>
              <button onClick={handlePromptConfirm} style={btnStyle('action')}>Confirm →</button>
            </div>
          </div>
        )}

        {/* Stage: review */}
        {stage === 'review' && (
          <>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#4ade80', fontWeight: 600 }}>✚ {newCount} new</span>
              <span style={{ fontSize: 13, color: '#facc15', fontWeight: 600 }}>↑ {updateCount} updates</span>
              {errorCount > 0 && <span style={{ fontSize: 13, color: '#f87171', fontWeight: 600 }}>✕ {errorCount} errors</span>}
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--sv-etch)', borderRadius: 8, maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--sv-bg-2)', position: 'sticky', top: 0 }}>
                    {['Product Name','SKU','Action','Details'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--sv-text-dim)', fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--sv-etch)', opacity: row.action === 'error' ? 0.6 : 1 }}>
                      <td style={{ padding: '6px 12px', color: 'var(--sv-text-main)', fontWeight: 500 }}>{row.product_name || '—'}</td>
                      <td style={{ padding: '6px 12px', color: 'var(--sv-text-dim)', fontFamily: 'monospace' }}>{row.sku || '—'}</td>
                      <td style={{ padding: '6px 12px' }}>{actionBadge(row.action)}</td>
                      <td style={{ padding: '6px 12px', color: 'var(--sv-text-dim)', fontSize: 11 }}>
                        {row.action === 'error' && <span style={{ color: '#f87171' }}>{row.errorMsg}</span>}
                        {row.action === 'update' && row.changedFields && row.changedFields.length > 0 && (
                          <span>Updates: {row.changedFields.join(', ')}</span>
                        )}
                        {row.action === 'update' && (!row.changedFields || row.changedFields.length === 0) && (
                          <span style={{ color: 'var(--sv-text-dim)' }}>No detected changes</span>
                        )}
                        {row.action === 'new_variant' && <span>Adding variant to existing product</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
             