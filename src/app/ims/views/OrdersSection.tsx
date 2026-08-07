import React from 'react';

type ImsView =
  | 'dashboard' | 'products' | 'stock' | 'brands' | 'gift-cards' | 'bulk-edit'
  | 'contacts' | 'locations'
  | 'purchase-orders' | 'sales-orders' | 'backorders' | 'credit-notes' | 'supplier-credit-notes' | 'branch-transfers' | 'smart-device-receive' | 'order-planner'
  | 'receive-transfers'
  | 'pos-sales' | 'online-sales' | 'stocktakes'
  | 'reports' | 'report-sales-by-branch' | 'report-sales-summary' | 'report-sales-search' | 'report-inventory-valuation' | 'report-product-margin' | 'report-pos-price-changes' | 'report-pos-registers' | 'report-cash-banking'
  | 'xero' | 'shopify';

interface OrdersSectionProps {
  view: ImsView;
  isAdvisor: boolean;
  businessId: string;
  pendingOpenPO: number | null;
  pendingOpenSO: number | null;
  pendingOpenCN: number | null;
  pendingOpenPosSale: number | null;
  pendingOpenPosDay: string | null;
  cnPrefill: any;
  setView: (v: ImsView) => void;
  setPendingOpenPO: (id: number | null) => void;
  setPendingOpenSO: (id: number | null) => void;
  setPendingOpenCN: (id: number | null) => void;
  setPendingOpenPosSale: (id: number | null) => void;
  setPendingOpenPosDay: (date: string | null) => void;
  setCnPrefill: (v: any) => void;
  PurchaseOrdersView: any;
  SalesOrdersView: any;
  BackordersView: any;
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
  pendingOpenCN,
  pendingOpenPosSale,
  pendingOpenPosDay,
  cnPrefill,
  setView,
  setPendingOpenPO,
  setPendingOpenSO,
  setPendingOpenCN,
  setPendingOpenPosSale,
  setPendingOpenPosDay,
  setCnPrefill,
  PurchaseOrdersView,
  SalesOrdersView,
  BackordersView,
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
          pendingOpenPosSaleId={pendingOpenPosSale}
          onPendingPosSaleHandled={() => setPendingOpenPosSale(null)}
          onReturnOrder={(p: any) => { setCnPrefill(p); setView('credit-notes'); }}
        />
      )}
      {view === 'backorders' && (
        <BackordersView
          isAdvisor={isAdvisor}
          onOpenOrder={(type: 'customer' | 'supplier', id: number) => {
            if (type === 'customer') { setPendingOpenSO(id); setView('sales-orders'); }
            else { setPendingOpenPO(id); setView('purchase-orders'); }
          }}
        />
      )}
      {view === 'credit-notes' && (
        <CreditNotesView
          isAdvisor={isAdvisor}
          prefill={cnPrefill}
          onPrefillConsumed={() => setCnPrefill(null)}
          pendingOpenId={pendingOpenCN}
          onPendingHandled={() => setPendingOpenCN(null)}
        />
      )}
      {view === 'supplier-credit-notes' && <SupplierCreditNotesView isAdvisor={isAdvisor} />}
      {view === 'branch-transfers' && <BranchTransfersView />}
      {view === 'receive-transfers' && <ReceiveTransfersView />}
      {view === 'pos-sales' && <PosSalesView pendingOpenDay={pendingOpenPosDay} onPendingHandled={() => setPendingOpenPosDay(null)} />}
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
