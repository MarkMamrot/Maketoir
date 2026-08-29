import React from 'react';

type ImsView =
  | 'dashboard' | 'products' | 'stock' | 'brands' | 'gift-cards' | 'bulk-edit'
  | 'contacts' | 'locations'
  | 'purchase-orders' | 'sales-orders' | 'stock-availability' | 'backorders' | 'customer-backorders' | 'supplier-backorders' | 'credit-notes' | 'supplier-credit-notes' | 'branch-transfers' | 'smart-device-receive' | 'order-planner'
  | 'receive-transfers'
  | 'pos-sales' | 'online-sales' | 'stocktakes'
  | 'reports' | 'report-sales-by-branch' | 'report-sales-summary' | 'report-sales-search' | 'report-inventory-valuation' | 'report-product-margin' | 'report-pos-price-changes' | 'report-pos-registers' | 'report-cash-banking'
  | 'xero' | 'shopify';

interface OrdersSectionProps {
  view: ImsView;
  isAdvisor: boolean;
  businessId: string;
  xeroAccountingEnabled: boolean;
  pendingOpenPO: number | null;
  pendingOpenSO: number | null;
  pendingOpenCN: number | null;
  pendingOpenSCN: number | null;
  pendingOpenPosSale: number | null;
  pendingOpenPosDay: string | null;
  cnPrefill: any;
  scnPrefill: any;
  setView: (v: ImsView) => void;
  setPendingOpenPO: (id: number | null) => void;
  setPendingOpenSO: (id: number | null) => void;
  setPendingOpenCN: (id: number | null) => void;
  setPendingOpenSCN: (id: number | null) => void;
  setPendingOpenPosSale: (id: number | null) => void;
  setPendingOpenPosDay: (date: string | null) => void;
  setCnPrefill: (v: any) => void;
  setScnPrefill: (v: any) => void;
  PurchaseOrdersView: any;
  SalesOrdersView: any;
  StockAvailabilityWorkbenchView: any;
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
  xeroAccountingEnabled,
  pendingOpenPO,
  pendingOpenSO,
  pendingOpenCN,
  pendingOpenSCN,
  pendingOpenPosSale,
  pendingOpenPosDay,
  cnPrefill,
  scnPrefill,
  setView,
  setPendingOpenPO,
  setPendingOpenSO,
  setPendingOpenCN,
  setPendingOpenSCN,
  setPendingOpenPosSale,
  setPendingOpenPosDay,
  setCnPrefill,
  setScnPrefill,
  PurchaseOrdersView,
  SalesOrdersView,
  StockAvailabilityWorkbenchView,
  BackordersView,
  CreditNotesView,
  SupplierCreditNotesView,
  BranchTransfersView,
  ReceiveTransfersView,
  PosSalesView,
  OnlineSalesView,
  OrderPlannerView,
}: OrdersSectionProps) {
  const openActivityDocument = (entry: { documentType?: string; documentId?: number }) => {
    const id = Number(entry.documentId ?? 0);
    if (!id) return;
    if (entry.documentType === 'purchase_order') { setPendingOpenPO(id); setView('purchase-orders'); }
    else if (entry.documentType === 'sales_order') { setPendingOpenSO(id); setView('sales-orders'); }
    else if (entry.documentType === 'credit_note') { setPendingOpenCN(id); setView('credit-notes'); }
    else if (entry.documentType === 'supplier_credit_note') { setPendingOpenSCN(id); setView('supplier-credit-notes'); }
  };

  return (
    <>
      {view === 'purchase-orders' && (
        <PurchaseOrdersView
          isAdvisor={isAdvisor}
          pendingOpenId={pendingOpenPO}
          onPendingHandled={() => setPendingOpenPO(null)}
          onOpenActivityDocument={openActivityDocument}
          onSupplierReturn={(prefill: any) => { setScnPrefill(prefill); setView('supplier-credit-notes'); }}
        />
      )}
      {view === 'sales-orders' && (
        <SalesOrdersView
          isAdvisor={isAdvisor}
          pendingOpenId={pendingOpenSO}
          onPendingHandled={() => setPendingOpenSO(null)}
          onOpenActivityDocument={openActivityDocument}
          pendingOpenPosSaleId={pendingOpenPosSale}
          onPendingPosSaleHandled={() => setPendingOpenPosSale(null)}
          onReturnOrder={(p: any) => { setCnPrefill(p); setView('credit-notes'); }}
        />
      )}
      {view === 'stock-availability' && (
        <StockAvailabilityWorkbenchView
          isAdvisor={isAdvisor}
          onOpenSalesOrder={(id: number) => { setPendingOpenSO(id); setView('sales-orders'); }}
        />
      )}
      {['backorders', 'customer-backorders', 'supplier-backorders'].includes(view) && (
        <BackordersView
          isAdvisor={isAdvisor}
          initialType={view === 'supplier-backorders' ? 'supplier' : 'customer'}
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
      {view === 'supplier-credit-notes' && (
        <SupplierCreditNotesView
          isAdvisor={isAdvisor}
          prefill={scnPrefill}
          onPrefillConsumed={() => setScnPrefill(null)}
          pendingOpenId={pendingOpenSCN}
          onPendingHandled={() => setPendingOpenSCN(null)}
        />
      )}
      {view === 'branch-transfers' && <BranchTransfersView />}
      {view === 'receive-transfers' && <ReceiveTransfersView />}
      {view === 'pos-sales' && <PosSalesView pendingOpenDay={pendingOpenPosDay} onPendingHandled={() => setPendingOpenPosDay(null)} />}
      {view === 'online-sales' && (
        <OnlineSalesView
          businessId={businessId}
          xeroAccountingEnabled={xeroAccountingEnabled}
          onReturnOrder={(p: any) => { setCnPrefill(p); setView('credit-notes'); }}
        />
      )}
      {view === 'order-planner' && <OrderPlannerView databaseId={businessId} />}
    </>
  );
}
