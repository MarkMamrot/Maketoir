import React from 'react';
import { CogsTraceabilityView } from './reports/CogsTraceabilityView';

import type { ImsView } from './MainSections';

interface ReportsSectionProps {
  view: ImsView;
  xeroAccountingEnabled: boolean;
  canReviewBookkeeperAudit: boolean;
  setView: (v: ImsView) => void;
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
  BookkeeperAuditView: any;
}

export function ReportsSection({
  view,
  xeroAccountingEnabled,
  canReviewBookkeeperAudit,
  setView,
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
  BookkeeperAuditView,
}: ReportsSectionProps) {
  return (
    <>
      {view === 'reports' && <ReportsView onNav={setView} xeroAccountingEnabled={xeroAccountingEnabled} />}
      {(view === 'report-sales-detail' || view === 'report-sales-by-branch') && <SalesByBranchView onBack={() => setView('reports')} />}
      {view === 'report-sales-summary' && <SalesSummaryView onBack={() => setView('reports')} />}
      {view === 'report-sales-search' && <SalesSearchView onBack={() => setView('reports')} />}
      {view === 'report-inventory-valuation' && <InventoryValuationView onBack={() => setView('reports')} />}
      {view === 'report-product-margin' && <ProductMarginView onBack={() => setView('reports')} />}
      {view === 'report-pos-price-changes' && <PosPriceChangesView onBack={() => setView('reports')} />}
      {view === 'report-pos-registers' && <PosRegistersReportView onBack={() => setView('reports')} />}
      {view === 'report-cash-banking' && xeroAccountingEnabled && <CashBankingReportView onBack={() => setView('reports')} />}
      {view === 'report-stock-availability' && <StockAvailabilityManagementView onBack={() => setView('reports')} />}
      {view === 'report-bookkeeper-audit' && <BookkeeperAuditView onBack={() => setView('reports')} canReview={canReviewBookkeeperAudit} />}
      {view === 'report-cogs-traceability' && <CogsTraceabilityView onBack={() => setView('reports')} />}
    </>
  );
}
