import React from 'react';
import { ProductsSection } from './ProductsSection';
import { OrdersSection } from './OrdersSection';
import { ReportsSection } from './ReportsSection';

type ImsView =
  | 'dashboard' | 'products' | 'stock' | 'brands' | 'gift-cards' | 'bulk-edit'
  | 'contacts' | 'locations'
  | 'purchase-orders' | 'sales-orders' | 'credit-notes' | 'supplier-credit-notes' | 'branch-transfers' | 'smart-device-receive' | 'order-planner'
  | 'receive-transfers'
  | 'pos-sales' | 'online-sales' | 'stocktakes'
  | 'reports' | 'report-sales-by-branch' | 'report-sales-search' | 'report-inventory-valuation' | 'report-product-margin' | 'report-pos-price-changes' | 'report-pos-registers'
  | 'xero' | 'shopify';

interface MainSectionsProps {
  view: ImsView;
  isAdvisor: boolean;
  advisorMappingEnabled: boolean;
  businessId: string;
  hasForesight: boolean;
  pendingOpenPO: number | null;
  pendingOpenSO: number | null;
  cnPrefill: any;
  setView: (v: ImsView) => void;
  setSettingsSection: (section: any) => void;
  setSettingsOpen: (open: boolean) => void;
  setPendingOpenPO: (id: number | null) => void;
  setPendingOpenSO: (id: number | null) => void;
  setCnPrefill: (v: any) => void;

  DashboardView: any;
  ProductsView: any;
  StockView: any;
  BulkEditView: any;
  ContactsView: any;
  LocationsView: any;
  PurchaseOrdersView: any;
  SalesOrdersView: any;
  CreditNotesView: any;
  SupplierCreditNotesView: any;
  BranchTransfersView: any;
  ReceiveTransfersView: any;
  BrandsView: any;
  GiftCardsView: any;
  PosSalesView: any;
  OnlineSalesView: any;
  StocktakesView: any;
  ReportsView: any;
  SalesByBranchView: any;
  SalesSearchView: any;
  InventoryValuationView: any;
  ProductMarginView: any;
  PosPriceChangesView: any;
  PosRegistersReportView: any;
  XeroView: any;
  ShopifyView: any;
  OrderPlannerView: any;
}

/**
 * First-stage IMS page decomposition: keep existing view components as-is,
 * but move the giant render switch out of page.tsx into a dedicated module.
 *
 * This gives us clean Products/Orders/Reports group boundaries now, so later
 * extraction can move one cluster at a time with lower regression risk.
 */
export function MainSections(props: MainSectionsProps) {
  const {
    view,
    isAdvisor,
    advisorMappingEnabled,
    businessId,
    hasForesight,
    pendingOpenPO,
    pendingOpenSO,
    cnPrefill,
    setView,
    setSettingsSection,
    setSettingsOpen,
    setPendingOpenPO,
    setPendingOpenSO,
    setCnPrefill,
    DashboardView,
    ProductsView,
    StockView,
    BulkEditView,
    ContactsView,
    LocationsView,
    PurchaseOrdersView,
    SalesOrdersView,
    CreditNotesView,
    SupplierCreditNotesView,
    BranchTransfersView,
    ReceiveTransfersView,
    BrandsView,
    GiftCardsView,
    PosSalesView,
    OnlineSalesView,
    StocktakesView,
    ReportsView,
    SalesByBranchView,
    SalesSearchView,
    InventoryValuationView,
    ProductMarginView,
    PosPriceChangesView,
    PosRegistersReportView,
    XeroView,
    ShopifyView,
    OrderPlannerView,
  } = props;

  return (
    <>
      {/* Core */}
      {view === 'dashboard' && (
        <DashboardView
          onNav={setView}
          onOpenSettings={(s: any) => { setSettingsSection(s); setSettingsOpen(true); }}
        />
      )}
      {view === 'contacts' && <ContactsView />}
      {view === 'locations' && <LocationsView isAdvisor={isAdvisor} />}
      {view === 'stocktakes' && <StocktakesView isAdvisor={isAdvisor} businessId={businessId} />}

      {/* Products section */}
      <ProductsSection
        view={view}
        isAdvisor={isAdvisor}
        businessId={businessId}
        hasForesight={hasForesight}
        setView={setView}
        setPendingOpenPO={setPendingOpenPO}
        setPendingOpenSO={setPendingOpenSO}
        ProductsView={ProductsView}
        StockView={StockView}
        BrandsView={BrandsView}
        GiftCardsView={GiftCardsView}
        BulkEditView={BulkEditView}
      />

      {/* Orders section */}
      <OrdersSection
        view={view}
        isAdvisor={isAdvisor}
        businessId={businessId}
        pendingOpenPO={pendingOpenPO}
        pendingOpenSO={pendingOpenSO}
        cnPrefill={cnPrefill}
        setView={setView}
        setPendingOpenPO={setPendingOpenPO}
        setPendingOpenSO={setPendingOpenSO}
        setCnPrefill={setCnPrefill}
        PurchaseOrdersView={PurchaseOrdersView}
        SalesOrdersView={SalesOrdersView}
        CreditNotesView={CreditNotesView}
        SupplierCreditNotesView={SupplierCreditNotesView}
        BranchTransfersView={BranchTransfersView}
        ReceiveTransfersView={ReceiveTransfersView}
        PosSalesView={PosSalesView}
        OnlineSalesView={OnlineSalesView}
        OrderPlannerView={OrderPlannerView}
      />

      {/* Reports section */}
      <ReportsSection
        view={view}
        setView={setView}
        ReportsView={ReportsView}
        SalesByBranchView={SalesByBranchView}
        SalesSearchView={SalesSearchView}
        InventoryValuationView={InventoryValuationView}
        ProductMarginView={ProductMarginView}
        PosPriceChangesView={PosPriceChangesView}
        PosRegistersReportView={PosRegistersReportView}
      />

      {/* Integrations */}
      {view === 'xero' && <XeroView businessId={businessId} isAdvisor={isAdvisor} advisorMappingEnabled={advisorMappingEnabled} />}
      {view === 'shopify' && <ShopifyView businessId={businessId} />}
    </>
  );
}
