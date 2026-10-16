import React from 'react';

import type { ImsView } from './MainSections';

interface ProductsSectionProps {
  view: ImsView;
  isAdvisor: boolean;
  businessId: string;
  hasForesight: boolean;
  buildsEnabled: boolean;
  setView: (v: ImsView) => void;
  setPendingOpenPO: (id: number | null) => void;
  setPendingOpenSO: (id: number | null) => void;
  ProductsView: any;
  ProductBuildsView: any;
  StockView: any;
  BrandsView: any;
  GiftCardsView: any;
  BulkEditView: any;
  BulkAddEditProductsView: any;
}

export function ProductsSection({
  view,
  isAdvisor,
  businessId,
  hasForesight,
  buildsEnabled,
  setView,
  setPendingOpenPO,
  setPendingOpenSO,
  ProductsView,
  ProductBuildsView,
  StockView,
  BrandsView,
  GiftCardsView,
  BulkEditView,
  BulkAddEditProductsView,
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
      {view === 'builds' && buildsEnabled && <ProductBuildsView isAdvisor={isAdvisor} />}
      {view === 'stock' && <StockView />}
      {view === 'brands' && <BrandsView />}
      {view === 'gift-cards' && <GiftCardsView />}
      {view === 'bulk-edit' && <BulkEditView />}
      {view === 'bulk-add-edit' && <BulkAddEditProductsView businessId={businessId} isAdvisor={isAdvisor} />}
    </>
  );
}
