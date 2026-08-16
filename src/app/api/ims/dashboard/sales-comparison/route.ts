import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  buildDashboardSalesComparisons,
  earliestDashboardComparisonDate,
} from '@/lib/ims/dashboardSalesComparison';
import { getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

type DailyRow = {
  sale_date: string;
  sales: number;
};

type EarliestRow = {
  earliest_sale_date: string | null;
};

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

  const businessId = String(session.businessId);

  try {
    const timeZone = await getBusinessTimeZone(businessId);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone });
    const from = earliestDashboardComparisonDate(today);
    const dateParams = [from, today, from, today, from, today];

    const [dailyRows, earliestRows] = await Promise.all([
      imsQuery<DailyRow>(
        `SELECT DATE_FORMAT(s.sale_date, '%Y-%m-%d') AS sale_date,
                COALESCE(SUM(s.revenue), 0) AS sales
         FROM (
           SELECT DATE(h.invoice_date) AS sale_date, COALESCE(h.line_total, 0) AS revenue
           FROM ims_sales_history h
           WHERE DATE(h.invoice_date) BETWEEN ? AND ?

           UNION ALL

           SELECT DATE(ps.completed_at) AS sale_date, COALESCE(psi.line_total, 0) AS revenue
           FROM pos_sale_items psi
           JOIN pos_sales ps ON ps.id = psi.sale_id
           WHERE ps.status = 'completed'
             AND ps.sale_type = 'sale'
             AND ps.is_historical = 0
             AND DATE(ps.completed_at) BETWEEN ? AND ?

           UNION ALL

           SELECT DATE(so.order_date) AS sale_date, COALESCE(soi.line_total, 0) AS revenue
           FROM ims_sales_order_items soi
           JOIN ims_sales_orders so ON so.id = soi.so_id
           WHERE so.status NOT IN ('draft', 'cancelled')
             AND so.cin7_order_id IS NULL
             AND DATE(so.order_date) BETWEEN ? AND ?
         ) s
         GROUP BY s.sale_date
         ORDER BY s.sale_date`,
        dateParams,
      ),
      imsQuery<EarliestRow>(
        `SELECT DATE_FORMAT(MIN(d.sale_date), '%Y-%m-%d') AS earliest_sale_date
         FROM (
           SELECT MIN(DATE(h.invoice_date)) AS sale_date
           FROM ims_sales_history h

           UNION ALL

           SELECT MIN(DATE(ps.completed_at)) AS sale_date
           FROM pos_sale_items psi
           JOIN pos_sales ps ON ps.id = psi.sale_id
           WHERE ps.status = 'completed'
             AND ps.sale_type = 'sale'
             AND ps.is_historical = 0

           UNION ALL

           SELECT MIN(DATE(so.order_date)) AS sale_date
           FROM ims_sales_order_items soi
           JOIN ims_sales_orders so ON so.id = soi.so_id
           WHERE so.status NOT IN ('draft', 'cancelled')
             AND so.cin7_order_id IS NULL
         ) d`,
      ),
    ]);

    const rows = dailyRows.map(row => ({
      saleDate: row.sale_date,
      sales: Number(row.sales ?? 0),
    }));
    const earliestSaleDate = earliestRows[0]?.earliest_sale_date ?? null;

    return NextResponse.json({
      success: true,
      today,
      earliestSaleDate,
      comparisons: {
        prior_period: buildDashboardSalesComparisons(rows, earliestSaleDate, today, 'prior_period'),
        year_ago: buildDashboardSalesComparisons(rows, earliestSaleDate, today, 'year_ago'),
      },
    });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims-dashboard',
      operation: 'load-sales-comparison',
      title: 'Dashboard sales comparison failed',
      error,
    });
    return NextResponse.json({ success: false, error: 'Failed to load sales comparison' }, { status: 500 });
  }
}