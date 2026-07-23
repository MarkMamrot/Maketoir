import React from 'react';

type ImsView =
  | 'dashboard' | 'products' | 'stock' | 'brands' | 'gift-cards' | 'bulk-edit'
  | 'contacts' | 'locations'
  | 'purchase-orders' | 'sales-orders' | 'credit-notes' | 'supplier-credit-notes' | 'branch-transfers' | 'smart-device-receive' | 'order-planner'
  | 'receive-transfers'
  | 'pos-sales' | 'online-sales' | 'stocktakes'
  | 'reports' | 'report-sales-by-branch' | 'report-sales-search' | 'report-inventory-valuation' | 'report-product-margin' | 'report-pos-price-changes' | 'report-pos-registers'
  | 'xero' | 'shopify';

interface ReportsSectionProps {
  view: ImsView;
  setView: (v: ImsView) => void;
  ReportsView: any;
  SalesByBranchView: any;
  SalesSearchView: any;
  InventoryValuationView: any;
  ProductMarginView: any;
  PosPriceChangesView: any;
  PosRegistersReportView: any;
}

export function ReportsSection({
  view,
  setView,
  ReportsView,
  SalesByBranchView,
  SalesSearchView,
  InventoryValuationView,
  ProductMarginView,
  PosPriceChangesView,
  PosRegistersReportView,
}: ReportsSectionProps) {
  return (
    <>
      {view === 'reports' && <ReportsView onNav={setView} />}
      {view === 'report-sales-by-branch' && <SalesByBranchView onBack={() => setView('reports')} />}
      {view === 'report-sales-search' && <SalesSearchView onBack={() => setView('reports')} />}
      {view === 'report-inventory-valuation' && <InventoryValuationView onBack={() => setView('reports')} />}
      {view === 'report-product-margin' && <ProductMarginView onBack={() => setView('reports')} />}
      {view === 'report-pos-price-changes' && <PosPriceChangesView onBack={() => setView('reports')} />}
      {view === 'report-pos-registers' && <PosRegistersReportView onBack={() => setView('reports')} />}
    </>
  );
}
