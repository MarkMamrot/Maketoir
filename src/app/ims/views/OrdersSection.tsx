import React from 'react';

type ImsView =
  | 'dashboard' | 'products' | 'stock' | 'brands' | 'gift-cards' | 'bulk-edit'
  | 'contacts' | 'locations'
  | 'purchase-orders' | 'sales-orders' | 'credit-notes' | 'supplier-credit-notes' | 'branch-transfers' | 'smart-device-receive' | 'order-planner'
  | 'receive-transfers'
  | 'pos-sales' | 'online-sales' | 'stocktakes'
  | 'reports' | 'report-sales-by-branch' | 'report-sales-search' | 'report-inventory-valuation' | 'report-product-margin' | 'report-pos-price-changes' | 'report-pos-registers'
  | 'xero' | 'shopify';

interface OrdersSectionProps {
  view: ImsView;
  isAdvisor: boolean;
  businessId: string;
  pendingOpenPO: number | null;
  pendingOpenSO: number | null;
  cnPrefill: any;
  setView: (v: ImsView) => void;
  setPendingOpenPO: (id: number | null) => void;
  setPendingOpenSO: (id: number | null) => void;
  setCnPrefill: (v: any) => void;
  PurchaseOrdersView: any;
  SalesOrdersView: any;
  CreditNotesView: any;
  SupplierCreditNotesView: any;
  BranchTransfersView: any;
  ReceiveTransfersView: any;
  PosSalesView: any;
  OnlineSalesView: any;
  OrderPlannerView: any;
}

export function OrdersSection({
  view,
  isAdvisor,
  businessId,
  pendingOpenPO,
  pendingOpenSO,
  cnPrefill,
  setView,
  setPendingOpenPO,
  setPendingOpenSO,
  setCnPrefill,
  PurchaseOrdersView,
  SalesOrdersView,
  CreditNotesView,
  SupplierCreditNotesView,
  BranchTransfersView,
  ReceiveTransfersView,
  PosSalesView,
  OnlineSalesView,
  OrderPlannerView,
}: OrdersSectionProps) {
  return (
    <>
      {view === 'purchase-orders' && (
        <PurchaseOrdersView
          isAdvisor={isAdvisor}
          pendingOpenId={pendingOpenPO}
          onPendingHandled={() => setPendingOpenPO(null)}
        />
      )}
      {view === 'sales-orders' && (
        <SalesOrdersView
          isAdvisor={isAdvisor}
          pendingOpenId={pendingOpenSO}
          onPendingHandled={() => setPendingOpenSO(null)}
          onReturnOrder={(p: any) => { setCnPrefill(p); setView('credit-notes'); }}
        />
      )}
      {view === 'credit-notes' && (
        <CreditNotesView
          isAdvisor={isAdvisor}
          prefill={cnPrefill}
          onPrefillConsumed={() => setCnPrefill(null)}
        />
      )}
      {view === 'supplier-credit-notes' && <SupplierCreditNotesView isAdvisor={isAdvisor} />}
      {view === 'branch-transfers' && <BranchTransfersView />}
      {view === 'receive-transfers' && <ReceiveTransfersView />}
      {view === 'pos-sales' && <PosSalesView />}
      {view === 'online-sales' && (
        <OnlineSalesView
          businessId={businessId}
          onReturnOrder={(p: any) => { setCnPrefill(p); setView('credit-notes'); }}
        />
      )}
      {view === 'order-planner' && <OrderPlannerView databaseId={businessId} />}
    </>
  );
}
