import React from 'react';
import { ProductsSection } from './ProductsSection';
import { OrdersSection } from './OrdersSection';
import { ReportsSection } from './ReportsSection';
import { ContactCrmProfile } from './contacts/ContactCrmProfile';
import { WholesaleApplicationQueue } from './wholesale/WholesaleApplicationQueue';
import OnlineShopView from './onlineShop/OnlineShopView';

type ImsView =
  | 'dashboard' | 'products' | 'stock' | 'brands' | 'gift-cards' | 'bulk-edit' | 'bulk-add-edit'
  | 'contacts' | 'crm' | 'contact-profile' | 'wholesale-applications' | 'locations' | 'location-daybooks'
  | 'purchase-orders' | 'sales-orders' | 'stock-availability' | 'backorders' | 'customer-backorders' | 'supplier-backorders' | 'credit-notes' | 'supplier-credit-notes' | 'branch-transfers' | 'smart-device-receive' | 'order-planner'
  | 'receive-transfers'
  | 'pos-sales' | 'online-sales' | 'stocktakes'
  | 'reports' | 'report-sales-detail' | 'report-sales-by-branch' | 'report-sales-summary' | 'report-sales-search' | 'report-inventory-valuation' | 'report-product-margin' | 'report-pos-price-changes' | 'report-pos-registers' | 'report-cash-banking' | 'report-stock-availability'
  | 'xero' | 'shopify' | 'online-shop';

interface MainSectionsProps {
  view: ImsView;
  xeroAccountingEnabled: boolean;
  shopifyEnabled: boolean;
  nativeShopEnabled: boolean;
  isAdvisor: boolean;
  advisorMappingEnabled: boolean;
  businessId: string;
  hasForesight: boolean;
  userName: string;
  userTier?: string;
  pendingOpenPO: number | null;
  pendingOpenSO: number | null;
  pendingOpenCN: number | null;
  pendingOpenSCN: number | null;
  pendingOpenPosSale: number | null;
  pendingOpenPosDay: string | null;
  pendingOpenContact: number | null;
  cnPrefill: any;
  scnPrefill: any;
  setView: (v: ImsView) => void;
  setSettingsSection: (section: any) => void;
  setSettingsOpen: (open: boolean) => void;
  setPendingOpenPO: (id: number | null) => void;
  setPendingOpenSO: (id: number | null) => void;
  setPendingOpenCN: (id: number | null) => void;
  setPendingOpenSCN: (id: number | null) => void;
  setPendingOpenPosSale: (id: number | null) => void;
  setPendingOpenPosDay: (date: string | null) => void;
  setPendingOpenContact: (id: number | null) => void;
  setCnPrefill: (v: any) => void;
  setScnPrefill: (v: any) => void;
  onOpenPurchaseOrder?: (id: number) => void;
  onOpenSalesOrder?: (id: number) => void;
  onOpenPosSale?: (id: number) => void;

  DashboardView: any;
  ProductsView: any;
  StockView: any;
  BulkEditView: any;
  BulkAddEditProductsView: any;
  ContactsView: any;
  LocationsView: any;
  LocationDaybooksView: any;
  PurchaseOrdersView: any;
  SalesOrdersView: any;
  StockAvailabilityWorkbenchView: any;
  BackordersView: any;
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
  SalesSummaryView: any;
  SalesSearchView: any;
  InventoryValuationView: any;
  ProductMarginView: any;
  PosPriceChangesView: any;
  PosRegistersReportView: any;
  CashBankingReportView: any;
  StockAvailabilityManagementView: any;
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
    xeroAccountingEnabled,
    shopifyEnabled,
    nativeShopEnabled,
    isAdvisor,
    advisorMappingEnabled,
    businessId,
    hasForesight,
    userName,
    userTier,
    pendingOpenPO,
    pendingOpenSO,
    pendingOpenCN,
    pendingOpenSCN,
    pendingOpenPosSale,
    pendingOpenPosDay,
    pendingOpenContact,
    cnPrefill,
    scnPrefill,
    setView,
    setSettingsSection,
    setSettingsOpen,
    setPendingOpenPO,
    setPendingOpenSO,
    setPendingOpenCN,
    setPendingOpenSCN,
    setPendingOpenPosSale,
    setPendingOpenPosDay,
    setPendingOpenContact,
    setCnPrefill,
    setScnPrefill,
    onOpenPurchaseOrder,
    onOpenSalesOrder,
    onOpenPosSale,
    DashboardView,
    ProductsView,
    StockView,
    BulkEditView,
    BulkAddEditProductsView,
    ContactsView,
    LocationsView,
    LocationDaybooksView,
    PurchaseOrdersView,
    SalesOrdersView,
    StockAvailabilityWorkbenchView,
    BackordersView,
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
    SalesSummaryView,
    SalesSearchView,
    InventoryValuationView,
    ProductMarginView,
    PosPriceChangesView,
    PosRegistersReportView,
    CashBankingReportView,
    StockAvailabilityManagementView,
    XeroView,
    ShopifyView,
    OrderPlannerView,
  } = props;

  return (
    <>
      {/* Core */}
      {view === 'dashboard' && (
        <DashboardView
          businessId={businessId}
          xeroAccountingEnabled={xeroAccountingEnabled}
          shopifyEnabled={shopifyEnabled}
          nativeShopEnabled={nativeShopEnabled}
          onNav={setView}
          onOpenSettings={(s: any) => { setSettingsSection(s); setSettingsOpen(true); }}
          onOpenPurchaseOrder={onOpenPurchaseOrder}
          onOpenSalesOrder={onOpenSalesOrder}
          onOpenPosSale={onOpenPosSale}
        />
      )}
      {view === 'contacts' && (
        <ContactsView
          mode="admin"
          isAdvisor={isAdvisor}
          onOpenProfile={(id: number) => {
            setPendingOpenContact(id);
            window.history.pushState(window.history.state, '', `#contact-profile/${id}`);
            setView('contact-profile');
          }}
        />
      )}
      {view === 'crm' && (
        <ContactsView
          mode="crm"
          isAdvisor={isAdvisor}
          onOpenProfile={(id: number) => {
            setPendingOpenContact(id);
            window.history.pushState(window.history.state, '', `#contact-profile/${id}`);
            setView('contact-profile');
          }}
        />
      )}
      {view === 'contact-profile' && pendingOpenContact && (
        <ContactCrmProfile
          contactId={pendingOpenContact}
          isAdvisor={isAdvisor}
          onBack={() => {
            setPendingOpenContact(null);
            window.history.pushState(window.history.state, '', '#crm');
            setView('crm');
          }}
          onOpenSalesOrder={(id: number) => { setPendingOpenSO(id); setView('sales-orders'); }}
          onOpenCreditNote={(id: number) => { setPendingOpenCN(id); setView('credit-notes'); }}
          onOpenPosSale={(id: number) => { setPendingOpenPosSale(id); setView('sales-orders'); }}
        />
      )}
      {view === 'wholesale-applications' && <WholesaleApplicationQueue isAdvisor={isAdvisor} />}
      {view === 'locations' && <LocationsView isAdvisor={isAdvisor} />}
      {view === 'location-daybooks' && <LocationDaybooksView userName={userName} userTier={userTier} />}
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
        BulkAddEditProductsView={BulkAddEditProductsView}
      />

      {/* Orders section */}
      <OrdersSection
        view={view}
        isAdvisor={isAdvisor}
        businessId={businessId}
        xeroAccountingEnabled={xeroAccountingEnabled}
        pendingOpenPO={pendingOpenPO}
        pendingOpenSO={pendingOpenSO}
        pendingOpenCN={pendingOpenCN}
        pendingOpenSCN={pendingOpenSCN}
        pendingOpenPosSale={pendingOpenPosSale}
        pendingOpenPosDay={pendingOpenPosDay}
        cnPrefill={cnPrefill}
        scnPrefill={scnPrefill}
        setView={setView}
        setPendingOpenPO={setPendingOpenPO}
        setPendingOpenSO={setPendingOpenSO}
        setPendingOpenCN={setPendingOpenCN}
        setPendingOpenSCN={setPendingOpenSCN}
        setPendingOpenPosSale={setPendingOpenPosSale}
        setPendingOpenPosDay={setPendingOpenPosDay}
        setCnPrefill={setCnPrefill}
        setScnPrefill={setScnPrefill}
        PurchaseOrdersView={PurchaseOrdersView}
        SalesOrdersView={SalesOrdersView}
        StockAvailabilityWorkbenchView={StockAvailabilityWorkbenchView}
        BackordersView={BackordersView}
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
        xeroAccountingEnabled={xeroAccountingEnabled}
        setView={setView}
        ReportsView={ReportsView}
        SalesByBranchView={SalesByBranchView}
        SalesSummaryView={SalesSummaryView}
        SalesSearchView={SalesSearchView}
        InventoryValuationView={InventoryValuationView}
        ProductMarginView={ProductMarginView}
        PosPriceChangesView={PosPriceChangesView}
        PosRegistersReportView={PosRegistersReportView}
        CashBankingReportView={CashBankingReportView}
        StockAvailabilityManagementView={StockAvailabilityManagementView}
      />

      {/* Integrations */}
      {view === 'xero' && xeroAccountingEnabled && (
        <XeroView
          businessId={businessId}
          isAdvisor={isAdvisor}
          advisorMappingEnabled={advisorMappingEnabled}
          onOpenPurchaseOrder={onOpenPurchaseOrder}
          onOpenSalesOrder={onOpenSalesOrder}
          onOpenCreditNote={(id: number) => { setView('credit-notes'); setPendingOpenCN(id); }}
          onOpenPosSale={(id: number) => { setView('sales-orders'); setPendingOpenPosSale(id); }}
          onOpenPosSalesDay={(date: string) => { setView('pos-sales'); setPendingOpenPosDay(date); }}
        />
      )}
      {view === 'shopify' && shopifyEnabled && <ShopifyView businessId={businessId} xeroAccountingEnabled={xeroAccountingEnabled} />}
      {view === 'online-shop' && nativeShopEnabled && <OnlineShopView />}
    </>
  );
}
