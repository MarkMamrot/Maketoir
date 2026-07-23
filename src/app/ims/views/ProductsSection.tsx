import React from 'react';

type ImsView =
  | 'dashboard' | 'products' | 'stock' | 'brands' | 'gift-cards' | 'bulk-edit'
  | 'contacts' | 'locations'
  | 'purchase-orders' | 'sales-orders' | 'credit-notes' | 'supplier-credit-notes' | 'branch-transfers' | 'smart-device-receive' | 'order-planner'
  | 'receive-transfers'
  | 'pos-sales' | 'online-sales' | 'stocktakes'
  | 'reports' | 'report-sales-by-branch' | 'report-sales-search' | 'report-inventory-valuation' | 'report-product-margin' | 'report-pos-price-changes' | 'report-pos-registers'
  | 'xero' | 'shopify';

interface ProductsSectionProps {
  view: ImsView;
  isAdvisor: boolean;
  businessId: string;
  hasForesight: boolean;
  setView: (v: ImsView) => void;
  setPendingOpenPO: (id: number | null) => void;
  setPendingOpenSO: (id: number | null) => void;
  ProductsView: any;
  StockView: any;
  BrandsView: any;
  GiftCardsView: any;
  BulkEditView: any;
}

export function ProductsSection({
  view,
  isAdvisor,
  businessId,
  hasForesight,
  setView,
  setPendingOpenPO,
  setPendingOpenSO,
  ProductsView,
  StockView,
  BrandsView,
  GiftCardsView,
  BulkEditView,
}: ProductsSectionProps) {
  return (
    <>
      {view === 'products' && (
        <ProductsView
          isAdvisor={isAdvisor}
          businessId={businessId}
          hasForesight={hasForesight}
          onNavigateToPO={(id: number) => { setView('purchase-orders'); setPendingOpenPO(id); }}
          onNavigateToSO={(id: number) => { setView('sales-orders'); setPendingOpenSO(id); }}
        />
      )}
      {view === 'stock' && <StockView />}
      {view === 'brands' && <BrandsView />}
      {view === 'gift-cards' && <GiftCardsView />}
      {view === 'bulk-edit' && <BulkEditView />}
    </>
  );
}
