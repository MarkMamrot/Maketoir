import { NextResponse } from 'next/server';
import { query } from '@/services/MySQLService';
import { getAdminSession } from '@/lib/sessionUtils';

export async function GET() {
  const user = getAdminSession();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });
  }

  if (user.tier !== 'Admin' && user.tier !== 'SuperAdmin') {
    return NextResponse.json({ success: false, error: 'Only admins can export data.' }, { status: 403 });
  }

  const businessId = user.businessId;
  if (!businessId) {
    return NextResponse.json({ success: false, error: 'No business associated with your account.' }, { status: 400 });
  }

  try {
    // Collect all data scoped to this business
    const [
      businesses, usersRows, config, connections, businessInfo, brandProfile,
      branches, suppliers, products, stock, sales, calcReports, yearlyRevenue,
      chats, shopifyProducts, shopifyOrders, marketingData, bulkEditHistory,
      productSchema, productVolumes, orderPlannerDrafts,
    ] = await Promise.all([
      query('SELECT business_id, name, drive_folder_id, created_at FROM businesses WHERE business_id = ? AND deleted_at IS NULL', [businessId]).catch(() => []),
      query(`SELECT u.id, u.name, u.company, u.email, u.phone, u.role, m.tier, u.registered_at, m.created_at
           FROM user_business_memberships m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
          WHERE m.business_id = ? AND m.deleted_at IS NULL`, [businessId]).catch(() => []),
      query('SELECT `key`, value, updated_at FROM config WHERE business_id = ?', [businessId]).catch(() => []),
      // Omit encrypted credential values — just export which connections are configured
      query('SELECT business_id, cin7_tenant, shopify_shop_domain, updated_at FROM connections WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM business_info WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM brand_profile WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM branches WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM suppliers WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM products WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM stock WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM sales WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM calc_reports WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM yearly_revenue WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT id, ts, role, summary, sentiment, tags, created_at FROM chats WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM shopify_products WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM shopify_orders WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM marketing_data WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM bulk_edit_history WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM product_schema WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM product_volumes WHERE business_id = ?', [businessId]).catch(() => []),
      query('SELECT * FROM order_planner_drafts WHERE business_id = ?', [businessId]).catch(() => []),
    ]);

    const exportData = {
      meta: {
        exportedAt: new Date().toISOString(),
        businessId,
        note: 'Encrypted credentials omitted for security. All other data included.',
      },
      businesses, users: usersRows, config, connections,
      businessInfo, brandProfile, branches, suppliers,
      products, stock, sales, calcReports, yearlyRevenue,
      chats, shopifyProducts, shopifyOrders, marketingData,
      bulkEditHistory, productSchema, productVolumes, orderPlannerDrafts,
    };

    const json = JSON.stringify(exportData, null, 2);
    const businessName = (businesses as any[])[0]?.name ?? 'business';
    const datestamp = new Date().toISOString().slice(0, 10);
    const filename = `solvantis-export-${businessName.replace(/[^a-z0-9]/gi, '-')}-${datestamp}.json`;

    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json({ success: false, error: error.message || String(error) }, { status: 500 });
  }
}
