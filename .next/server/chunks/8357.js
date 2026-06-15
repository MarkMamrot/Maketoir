exports.id=8357,exports.ids=[8357],exports.modules={62849:t=>{function a(t){var a=Error("Cannot find module '"+t+"'");throw a.code="MODULE_NOT_FOUND",a}a.keys=()=>[],a.resolve=a,a.id=62849,t.exports=a},69033:(t,a,e)=>{"use strict";e.d(a,{AX:()=>s,O3:()=>l,R5:()=>m,X_:()=>p,av:()=>E,bi:()=>r,j4:()=>d,kN:()=>c,p4:()=>S,qe:()=>v,yL:()=>u});var i=e(56573),o=e(46724);async function n(){let t=new Date().getFullYear(),a=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_purchase_orders WHERE po_number LIKE ?",[`PO-${t}-%`]),e=String((a[0]?.cnt??0)+1).padStart(4,"0");return`PO-${t}-${e}`}async function _(){let t=new Date().getFullYear(),a=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_sales_orders WHERE so_number LIKE ?",[`SO-${t}-%`]),e=String((a[0]?.cnt??0)+1).padStart(4,"0");return`SO-${t}-${e}`}let r={async list(t,a){let e=[],i=[];t&&(e.push("(type = ? OR type = 'both')"),i.push(t)),a&&e.push("is_active = 1");let n=e.length?"WHERE "+e.join(" AND "):"";return(0,o.UI)(`SELECT * FROM ims_contacts ${n} ORDER BY name`,i)},get:async t=>(await (0,o.UI)("SELECT * FROM ims_contacts WHERE id = ?",[t]))[0]??null,create:async t=>(await (0,o.MN)(`INSERT INTO ims_contacts (type,name,company,email,phone,address,city,state,postcode,country,notes,is_active,cin7_supplier_id,lead_time_days,order_frequency_days,price_tier)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[t.type,t.name,t.company,t.email,t.phone,t.address,t.city,t.state,t.postcode,t.country,t.notes,t.is_active??1,t.cin7_supplier_id??null,t.lead_time_days??null,t.order_frequency_days??45,t.price_tier??"retail"])).insertId,async update(t,a){let e=[],i=[];for(let t of["type","name","company","email","phone","address","city","state","postcode","country","notes","is_active","cin7_supplier_id","lead_time_days","order_frequency_days","price_tier"])void 0!==a[t]&&(e.push(`${t} = ?`),i.push(a[t]));e.length&&(i.push(t),await (0,o.MN)(`UPDATE ims_contacts SET ${e.join(", ")} WHERE id = ?`,i))},async delete(t){await (0,o.MN)("DELETE FROM ims_contacts WHERE id = ?",[t])}},s={list:async()=>(0,o.UI)("SELECT * FROM ims_locations ORDER BY name"),get:async t=>(await (0,o.UI)("SELECT * FROM ims_locations WHERE id = ?",[t]))[0]??null,create:async t=>(await (0,o.MN)(`INSERT INTO ims_locations (name,code,address,city,state,postcode,country,is_active,cin7_branch_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,[t.name,t.code,t.address,t.city,t.state,t.postcode,t.country,t.is_active??1,t.cin7_branch_id??null])).insertId,async update(t,a){let e=[],i=[];for(let t of["name","code","address","city","state","postcode","country","is_active","cin7_branch_id"])void 0!==a[t]&&(e.push(`${t} = ?`),i.push(a[t]));e.length&&(i.push(t),await (0,o.MN)(`UPDATE ims_locations SET ${e.join(", ")} WHERE id = ?`,i))},async delete(t){await (0,o.MN)("DELETE FROM ims_locations WHERE id = ?",[t])}},c={async list(){let t=await (0,o.UI)(`SELECT p.*, c.name AS supplier_name, c.is_active AS supplier_is_active
       FROM ims_products p
       LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
       ORDER BY p.created_at DESC`),a=await (0,o.UI)("SELECT * FROM ims_product_variants ORDER BY sku"),e=new Map;for(let t of a)e.has(t.product_id)||e.set(t.product_id,[]),e.get(t.product_id).push(t);return t.map(t=>({...t,variants:e.get(t.product_id)??[]}))},async get(t){let a=await (0,o.UI)("SELECT * FROM ims_products WHERE product_id = ?",[t]);if(!a[0])return null;let e=await (0,o.UI)("SELECT * FROM ims_product_variants WHERE product_id = ? ORDER BY sku",[t]);return{...a[0],variants:e}},async create(t){let a=t.product_id||(0,i.Z)();return await (0,o.MN)(`INSERT INTO ims_products (product_id,name,description,product_type,brand,tags,is_active,shopify_product_id,style_code,is_online,supplier_contact_id,cin7_product_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[a,t.name,t.description??null,t.product_type??null,t.brand??null,t.tags??null,t.is_active??1,t.shopify_product_id??null,t.style_code??null,t.is_online??1,t.supplier_contact_id??null,t.cin7_product_id??null]),a},async update(t,a){let e=[],i=[];for(let t of["name","description","product_type","brand","tags","is_active","shopify_product_id","style_code","is_online","supplier_contact_id","cin7_product_id"])void 0!==a[t]&&(e.push(`${t} = ?`),i.push(a[t]));e.length&&(i.push(t),await (0,o.MN)(`UPDATE ims_products SET ${e.join(", ")} WHERE product_id = ?`,i))},async delete(t){await (0,o.MN)("DELETE FROM ims_products WHERE product_id = ?",[t])},findByName:async t=>(await (0,o.UI)("SELECT * FROM ims_products WHERE LOWER(name) = LOWER(?) LIMIT 1",[t]))[0]??null},d={listAll:async()=>(0,o.UI)(`SELECT v.*, p.name AS product_name
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       ORDER BY p.name, v.sku`),listByProduct:async t=>(0,o.UI)("SELECT * FROM ims_product_variants WHERE product_id = ? ORDER BY sku",[t]),get:async t=>(await (0,o.UI)(`SELECT v.*, p.name AS product_name
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE v.variant_id = ?`,[t]))[0]??null,async create(t){let a=t.variant_id||(0,i.Z)();return await (0,o.MN)(`INSERT INTO ims_product_variants
         (variant_id,product_id,sku,barcode,option1_name,option1_value,
          option2_name,option2_value,option3_name,option3_value,
          cost,price,wholesale_price,discounted_price,discount_start_date,discount_end_date,
          weight_kg,shopify_variant_id,is_active,cost_foreign_json,pack_size,cin7_option_id,bin,zone)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[a,t.product_id,t.sku??null,t.barcode??null,t.option1_name??null,t.option1_value??null,t.option2_name??null,t.option2_value??null,t.option3_name??null,t.option3_value??null,t.cost??null,t.price??null,t.wholesale_price??null,t.discounted_price??null,t.discount_start_date??null,t.discount_end_date??null,t.weight_kg??null,t.shopify_variant_id??null,t.is_active??1,t.cost_foreign_json??null,t.pack_size??null,t.cin7_option_id??null,t.bin??null,t.zone??null]),a},async update(t,a){let e=[],i=[];for(let t of["sku","barcode","option1_name","option1_value","option2_name","option2_value","option3_name","option3_value","cost","price","wholesale_price","discounted_price","discount_start_date","discount_end_date","weight_kg","shopify_variant_id","is_active","cost_foreign_json","pack_size","cin7_option_id","bin","zone"])void 0!==a[t]&&(e.push(`${t} = ?`),i.push(a[t]));e.length&&(i.push(t),await (0,o.MN)(`UPDATE ims_product_variants SET ${e.join(", ")} WHERE variant_id = ?`,i))},async delete(t){await (0,o.MN)("DELETE FROM ims_product_variants WHERE variant_id = ?",[t])},findByBarcodeOrSku:async t=>(await (0,o.UI)(`SELECT v.*,
              p.name AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE v.barcode = ? OR v.sku = ?
       LIMIT 1`,[t,t]))[0]??null,findBySku:async t=>(await (0,o.UI)(`SELECT v.*, p.name AS product_name
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE v.sku = ? LIMIT 1`,[t]))[0]??null},l={list:async()=>(0,o.UI)("SELECT id, name, created_at FROM ims_brands ORDER BY name"),create:async t=>(await (0,o.MN)("INSERT INTO ims_brands (name) VALUES (?)",[t.trim()])).insertId,async update(t,a){await (0,o.MN)("UPDATE ims_brands SET name = ? WHERE id = ?",[a.trim(),t])},async delete(t){await (0,o.MN)("DELETE FROM ims_brands WHERE id = ?",[t])}},u={async list(t,a){let e=[],i=[];t&&(e.push("s.variant_id = ?"),i.push(t)),a&&(e.push("s.location_id = ?"),i.push(a));let n=e.length?"WHERE "+e.join(" AND "):"";try{return await (0,o.UI)(`SELECT s.*,
                v.sku, p.name AS product_name,
                p.brand AS brand,
                p.zone AS zone,
                p.bin AS bin,
                p.created_at AS created_at,
                c.name AS supplier_name,
                c.is_active AS supplier_is_active,
                l.name AS location_name,
                CONCAT_WS(' / ',
                  NULLIF(v.option1_value,''),
                  NULLIF(v.option2_value,''),
                  NULLIF(v.option3_value,'')
                ) AS variant_label
         FROM ims_stock s
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         LEFT JOIN ims_contacts c ON c.id = p.supplier_contact_id
         JOIN ims_locations l ON l.id = s.location_id
         ${n}
         ORDER BY p.name, v.sku, l.name`,i)}catch{return(0,o.UI)(`SELECT s.*,
                v.sku, p.name AS product_name,
                p.brand AS brand,
                l.name AS location_name,
                CONCAT_WS(' / ',
                  NULLIF(v.option1_value,''),
                  NULLIF(v.option2_value,''),
                  NULLIF(v.option3_value,'')
                ) AS variant_label
         FROM ims_stock s
         JOIN ims_product_variants v ON v.variant_id = s.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         JOIN ims_locations l ON l.id = s.location_id
         ${n}
         ORDER BY p.name, v.sku, l.name`,i)}},async upsert(t,a,e){await (0,o.MN)(`INSERT INTO ims_stock (variant_id, location_id, min_qty, reorder_qty)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         min_qty    = VALUES(min_qty),
         reorder_qty = VALUES(reorder_qty)`,[t,a,e.min_qty??0,e.reorder_qty??0])},getLowStock:async()=>(0,o.UI)(`SELECT s.*,
              v.sku, p.name AS product_name,
              l.name AS location_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label
       FROM ims_stock s
       JOIN ims_product_variants v ON v.variant_id = s.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
       JOIN ims_locations l ON l.id = s.location_id
       WHERE s.qty_on_hand <= s.min_qty AND s.min_qty > 0
       ORDER BY (s.qty_on_hand - s.min_qty) ASC`)},E={async list(t){let a=t?"WHERE po.status = ?":"",e=t?[t]:[];try{return await (0,o.UI)(`SELECT po.*,
                c.name AS supplier_name,
                l.name AS location_name,
                COALESCE(pay.amount_paid, 0) AS amount_paid,
                COALESCE(pay.amount_paid_local, 0) AS amount_paid_local,
                po.total_amount - COALESCE(pay.amount_paid, 0) AS balance,
                (po.total_amount * po.exchange_rate) - COALESCE(pay.amount_paid_local, 0) AS balance_local
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
         LEFT JOIN (
           SELECT po_id,
                  SUM(amount) AS amount_paid,
                  SUM(amount_local) AS amount_paid_local
           FROM ims_purchase_order_payments
           GROUP BY po_id
         ) pay ON pay.po_id = po.id
         ${a}
         ORDER BY po.created_at DESC`,e)}catch{return(0,o.UI)(`SELECT po.*, c.name AS supplier_name, l.name AS location_name
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
         ${a}
         ORDER BY po.created_at DESC`,e)}},async get(t){let a;let e=[];try{a=await (0,o.UI)(`SELECT po.*,
                c.name  AS supplier_name,
                c.email AS supplier_email,
                l.name  AS location_name,
                COALESCE(pay.amount_paid, 0) AS amount_paid,
                COALESCE(pay.amount_paid_local, 0) AS amount_paid_local,
                po.total_amount - COALESCE(pay.amount_paid, 0) AS balance,
                (po.total_amount * po.exchange_rate) - COALESCE(pay.amount_paid_local, 0) AS balance_local
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
         LEFT JOIN (
           SELECT po_id,
                  SUM(amount) AS amount_paid,
                  SUM(amount_local) AS amount_paid_local
           FROM ims_purchase_order_payments
           GROUP BY po_id
         ) pay ON pay.po_id = po.id
         WHERE po.id = ?`,[t]),e=await (0,o.UI)("SELECT * FROM ims_purchase_order_payments WHERE po_id = ? ORDER BY payment_date ASC, id ASC",[t])}catch{a=await (0,o.UI)(`SELECT po.*,
                c.name  AS supplier_name,
                c.email AS supplier_email,
                l.name  AS location_name
         FROM ims_purchase_orders po
         LEFT JOIN ims_contacts c ON c.id = po.supplier_id
         JOIN ims_locations l ON l.id = po.location_id
         WHERE po.id = ?`,[t])}if(!a[0])return null;let i=await (0,o.UI)(`SELECT i.*,
              v.sku,
              p.name AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label
       FROM ims_purchase_order_items i
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.po_id = ?`,[t]);return{...a[0],items:i,payments:e}},async addPayment(t,a){let e=await (0,o.MN)(`INSERT INTO ims_purchase_order_payments (po_id, payment_date, amount, currency_code, exchange_rate, amount_local, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,[t,a.payment_date,a.amount,a.currency_code,a.exchange_rate,a.amount_local,a.notes||null]);return(await (0,o.UI)("SELECT * FROM ims_purchase_order_payments WHERE id = ?",[e.insertId]))[0]},async deletePayment(t){await (0,o.MN)("DELETE FROM ims_purchase_order_payments WHERE id = ?",[t])},async create(t,a){let e=t.po_number||await n(),i=a.reduce((t,a)=>t+Number(a.line_total),0),_=a.reduce((t,a)=>t+Number(a.line_total)*Number(a.tax_rate),0),r=Number(t.freight??0),s=Number(t.discount??0),c=(await (0,o.MN)(`INSERT INTO ims_purchase_orders
         (po_number,supplier_id,location_id,status,order_date,expected_date,notes,
          supplier_invoice_number,payment_terms,freight,discount,subtotal,tax_amount,total_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[e,t.supplier_id??null,t.location_id,"draft",t.order_date,t.expected_date??null,t.notes??null,t.supplier_invoice_number??null,t.payment_terms??null,r,s,i,_,i+_+r-s])).insertId;for(let t of a){let a=Number(t.qty_ordered)*Number(t.unit_cost);await (0,o.MN)(`INSERT INTO ims_purchase_order_items
           (po_id,variant_id,qty_ordered,unit_cost,tax_rate,line_total,notes)
         VALUES (?,?,?,?,?,?,?)`,[c,t.variant_id,t.qty_ordered,t.unit_cost,t.tax_rate??0,a,t.notes??null])}return c},async update(t,a,e){let i=[],n=[];for(let t of["supplier_id","location_id","order_date","expected_date","notes","supplier_invoice_number","payment_terms","freight","discount"])void 0!==a[t]&&(i.push(`${t} = ?`),n.push(a[t]));let _=(0,o.xE)(),r=await _.getConnection();try{if(await r.beginTransaction(),i.length&&(n.push(t),await r.execute(`UPDATE ims_purchase_orders SET ${i.join(", ")} WHERE id = ?`,n)),e){await r.execute("DELETE FROM ims_purchase_order_items WHERE po_id = ?",[t]);let i=0,o=0;for(let a of e){let e=Number(a.qty_ordered)*Number(a.unit_cost),n=e*Number(a.tax_rate??0);i+=e,o+=n,await r.execute(`INSERT INTO ims_purchase_order_items
               (po_id,variant_id,qty_ordered,unit_cost,tax_rate,line_total,notes)
             VALUES (?,?,?,?,?,?,?)`,[t,a.variant_id,a.qty_ordered,a.unit_cost,a.tax_rate??0,e,a.notes??null])}let n=void 0!==a.freight?Number(a.freight):0,_=void 0!==a.discount?Number(a.discount):0,[[s]]=await r.execute("SELECT freight, discount FROM ims_purchase_orders WHERE id=?",[t]),c=void 0!==a.freight?n:Number(s?.freight??0),d=void 0!==a.discount?_:Number(s?.discount??0);await r.execute("UPDATE ims_purchase_orders SET subtotal=?, tax_amount=?, total_amount=? WHERE id=?",[i,o,i+o+c-d,t])}await r.commit()}catch(t){throw await r.rollback(),t}finally{r.release()}},async changeStatus(t,a){let e=(0,o.xE)(),i=await e.getConnection();try{await i.beginTransaction();let[[e]]=await i.execute("SELECT * FROM ims_purchase_orders WHERE id = ?",[t]);if(!e)throw Error("Purchase order not found");if(e.is_historical)throw Error("Cannot modify a historical Cin7 record");let n=await (0,o.UI)("SELECT * FROM ims_purchase_order_items WHERE po_id = ?",[t]),_=e.status;if(_===a)return;if("draft"===_&&"approved"===a)for(let a of n){await i.execute(`INSERT INTO ims_stock (variant_id, location_id, qty_incoming)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_incoming = qty_incoming + VALUES(qty_incoming)`,[a.variant_id,e.location_id,a.qty_ordered]);let[[o]]=await i.execute("SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,e.location_id]);await i.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'po_approved','purchase_order',?,?,?,?)`,[a.variant_id,e.location_id,t,a.qty_ordered,o?.qty_on_hand??0,a.unit_cost])}if("approved"===_&&"draft"===a)for(let a of n){await i.execute(`UPDATE ims_stock SET qty_incoming = GREATEST(0, qty_incoming - ?)
             WHERE variant_id=? AND location_id=?`,[a.qty_ordered,a.variant_id,e.location_id]);let[[o]]=await i.execute("SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,e.location_id]);await i.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'po_unapproved','purchase_order',?,?,?)`,[a.variant_id,e.location_id,t,-a.qty_ordered,o?.qty_on_hand??0])}if("approved"===_&&"received"===a){for(let a of n){await i.execute("INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)",[a.variant_id,e.location_id]);let[[o]]=await i.execute("SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,e.location_id]),n=Number(o?.qty_on_hand??0),_=Number(o?.avg_cost??a.unit_cost),r=Number(a.qty_ordered),s=n<=0?Number(a.unit_cost):(_*n+Number(a.unit_cost)*r)/(n+r),c=n+r;await i.execute(`UPDATE ims_stock
             SET qty_on_hand  = ?,
                 qty_incoming = GREATEST(0, qty_incoming - ?),
                 avg_cost     = ?
             WHERE variant_id=? AND location_id=?`,[c,r,s,a.variant_id,e.location_id]),await i.execute("UPDATE ims_purchase_order_items SET qty_received = qty_ordered WHERE id = ?",[a.id]),await i.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'po_received','purchase_order',?,?,?,?)`,[a.variant_id,e.location_id,t,r,c,s])}await i.execute("UPDATE ims_purchase_orders SET received_date = CURDATE() WHERE id = ?",[t])}if("cancelled"===a&&"approved"===_)for(let a of n){await i.execute(`UPDATE ims_stock SET qty_incoming = GREATEST(0, qty_incoming - ?)
             WHERE variant_id=? AND location_id=?`,[a.qty_ordered,a.variant_id,e.location_id]);let[[o]]=await i.execute("SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,e.location_id]);await i.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'po_unapproved','purchase_order',?,?,?)`,[a.variant_id,e.location_id,t,-a.qty_ordered,o?.qty_on_hand??0])}await i.execute("UPDATE ims_purchase_orders SET status = ? WHERE id = ?",[a,t]),await i.commit()}catch(t){throw await i.rollback(),t}finally{i.release()}},async delete(t){await (0,o.MN)("DELETE FROM ims_purchase_orders WHERE id = ?",[t])}},m={async list(t){let a=t?"WHERE so.so_type = 'b2b' AND so.status = ?":"WHERE so.so_type = 'b2b'",e=t?[t]:[];try{return await (0,o.UI)(`SELECT so.*,
                c.name AS customer_name,
                l.name AS location_name,
                COALESCE(pay.amount_paid, 0) AS amount_paid,
                COALESCE(pay.amount_paid_local, 0) AS amount_paid_local,
                so.total_amount - COALESCE(pay.amount_paid, 0) AS balance,
                (so.total_amount * so.exchange_rate) - COALESCE(pay.amount_paid_local, 0) AS balance_local
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         JOIN ims_locations l ON l.id = so.location_id
         LEFT JOIN (
           SELECT so_id,
                  SUM(amount) AS amount_paid,
                  SUM(amount_local) AS amount_paid_local
           FROM ims_sales_order_payments
           GROUP BY so_id
         ) pay ON pay.so_id = so.id
         ${a}
         ORDER BY so.created_at DESC`,e)}catch{return(0,o.UI)(`SELECT so.*, c.name AS customer_name, l.name AS location_name
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         JOIN ims_locations l ON l.id = so.location_id
         ${a}
         ORDER BY so.created_at DESC`,e)}},async get(t){let a;let e=[];try{a=await (0,o.UI)(`SELECT so.*,
                c.name  AS customer_name,
                c.email AS customer_email,
                l.name  AS location_name,
                COALESCE(pay.amount_paid, 0) AS amount_paid,
                COALESCE(pay.amount_paid_local, 0) AS amount_paid_local,
                so.total_amount - COALESCE(pay.amount_paid, 0) AS balance,
                (so.total_amount * so.exchange_rate) - COALESCE(pay.amount_paid_local, 0) AS balance_local
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         JOIN ims_locations l ON l.id = so.location_id
         LEFT JOIN (
           SELECT so_id,
                  SUM(amount) AS amount_paid,
                  SUM(amount_local) AS amount_paid_local
           FROM ims_sales_order_payments
           GROUP BY so_id
         ) pay ON pay.so_id = so.id
         WHERE so.id = ?`,[t]),e=await (0,o.UI)("SELECT * FROM ims_sales_order_payments WHERE so_id = ? ORDER BY payment_date ASC, id ASC",[t])}catch{a=await (0,o.UI)(`SELECT so.*,
                c.name  AS customer_name,
                c.email AS customer_email,
                l.name  AS location_name
         FROM ims_sales_orders so
         LEFT JOIN ims_contacts c ON c.id = so.customer_id
         JOIN ims_locations l ON l.id = so.location_id
         WHERE so.id = ?`,[t])}if(!a[0])return null;let i=await (0,o.UI)(`SELECT i.*,
              v.sku,
              COALESCE(p.name, i.name) AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label
       FROM ims_sales_order_items i
       LEFT JOIN ims_product_variants v ON v.variant_id = i.variant_id
       LEFT JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.so_id = ?`,[t]);return{...a[0],items:i,payments:e}},async addPayment(t,a){let e=await (0,o.MN)(`INSERT INTO ims_sales_order_payments (so_id, payment_date, amount, currency_code, exchange_rate, amount_local, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,[t,a.payment_date,a.amount,a.currency_code,a.exchange_rate,a.amount_local,a.notes||null]);return(await (0,o.UI)("SELECT * FROM ims_sales_order_payments WHERE id = ?",[e.insertId]))[0]},async deletePayment(t){await (0,o.MN)("DELETE FROM ims_sales_order_payments WHERE id = ?",[t])},async create(t,a){let e=t.so_number||await _(),i=0,n=0;for(let t of a){let a=1-Number(t.discount_pct??0),e=Number(t.qty_ordered)*Number(t.unit_price)*a;i+=e,n+=e*Number(t.tax_rate??0)}let r=Number(t.freight??0),s=Number(t.discount??0),c=(await (0,o.MN)(`INSERT INTO ims_sales_orders
         (so_number,customer_id,location_id,status,order_date,expected_date,notes,
          payment_terms,freight,discount,subtotal,tax_amount,total_amount,shopify_order_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[e,t.customer_id??null,t.location_id,"draft",t.order_date,t.expected_date??null,t.notes??null,t.payment_terms??null,r,s,i,n,i+n+r-s,t.shopify_order_id??null])).insertId;for(let t of a){let a=1-Number(t.discount_pct??0),e=Number(t.qty_ordered)*Number(t.unit_price)*a;await (0,o.MN)(`INSERT INTO ims_sales_order_items
           (so_id,variant_id,qty_ordered,unit_price,discount_pct,tax_rate,line_total,notes)
         VALUES (?,?,?,?,?,?,?,?)`,[c,t.variant_id,t.qty_ordered,t.unit_price,t.discount_pct??0,t.tax_rate??0,e,t.notes??null])}return c},async update(t,a,e){let i=[],n=[];for(let t of["customer_id","location_id","order_date","expected_date","notes","payment_terms","freight","discount"])void 0!==a[t]&&(i.push(`${t} = ?`),n.push(a[t]));let _=(0,o.xE)(),r=await _.getConnection();try{if(await r.beginTransaction(),i.length&&(n.push(t),await r.execute(`UPDATE ims_sales_orders SET ${i.join(", ")} WHERE id = ?`,n)),e){await r.execute("DELETE FROM ims_sales_order_items WHERE so_id = ?",[t]);let i=0,o=0;for(let a of e){let e=1-Number(a.discount_pct??0),n=Number(a.qty_ordered)*Number(a.unit_price)*e;i+=n,o+=n*Number(a.tax_rate??0),await r.execute(`INSERT INTO ims_sales_order_items
               (so_id,variant_id,qty_ordered,unit_price,discount_pct,tax_rate,line_total,notes)
             VALUES (?,?,?,?,?,?,?,?)`,[t,a.variant_id,a.qty_ordered,a.unit_price,a.discount_pct??0,a.tax_rate??0,n,a.notes??null])}let[[n]]=await r.execute("SELECT freight, discount FROM ims_sales_orders WHERE id=?",[t]),_=void 0!==a.freight?Number(a.freight):Number(n?.freight??0),s=void 0!==a.discount?Number(a.discount):Number(n?.discount??0);await r.execute("UPDATE ims_sales_orders SET subtotal=?, tax_amount=?, total_amount=? WHERE id=?",[i,o,i+o+_-s,t])}await r.commit()}catch(t){throw await r.rollback(),t}finally{r.release()}},async changeStatus(t,a){let e=(0,o.xE)(),i=await e.getConnection();try{await i.beginTransaction();let[[e]]=await i.execute("SELECT * FROM ims_sales_orders WHERE id = ?",[t]);if(!e)throw Error("Sales order not found");if(e.is_historical)throw Error("Cannot modify a historical Cin7 record");let n=await (0,o.UI)("SELECT * FROM ims_sales_order_items WHERE so_id = ?",[t]),_=e.status;if(_===a)return;if("draft"===_&&"confirmed"===a)for(let a of n){await i.execute(`INSERT INTO ims_stock (variant_id, location_id, qty_committed)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE qty_committed = qty_committed + VALUES(qty_committed)`,[a.variant_id,e.location_id,a.qty_ordered]);let[[o]]=await i.execute("SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,e.location_id]);await i.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'so_confirmed','sales_order',?,?,?)`,[a.variant_id,e.location_id,t,0,o?.qty_on_hand??0])}if("confirmed"===_&&"draft"===a)for(let a of n){await i.execute(`UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id=? AND location_id=?`,[a.qty_ordered,a.variant_id,e.location_id]);let[[o]]=await i.execute("SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,e.location_id]);await i.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh)
             VALUES (?,?,'so_unconfirmed','sales_order',?,?,?)`,[a.variant_id,e.location_id,t,0,o?.qty_on_hand??0])}if("confirmed"===_&&"fulfilled"===a){for(let a of n){await i.execute("INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)",[a.variant_id,e.location_id]);let[[o]]=await i.execute("SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,e.location_id]),n=Number(o?.qty_on_hand??0),_=Number(o?.avg_cost??0),r=Number(a.qty_ordered),s=n-r;await i.execute(`UPDATE ims_stock
             SET qty_on_hand  = ?,
                 qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id=? AND location_id=?`,[s,r,a.variant_id,e.location_id]),await i.execute("UPDATE ims_sales_order_items SET qty_fulfilled = qty_ordered, unit_cost = ? WHERE id = ?",[_,a.id]),await i.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'so_fulfilled','sales_order',?,?,?,?)`,[a.variant_id,e.location_id,t,-r,s,_])}await i.execute("UPDATE ims_sales_orders SET fulfilled_date = CURDATE() WHERE id = ?",[t])}if("cancelled"===a&&"confirmed"===_)for(let t of n)await i.execute(`UPDATE ims_stock SET qty_committed = GREATEST(0, qty_committed - ?)
             WHERE variant_id=? AND location_id=?`,[t.qty_ordered,t.variant_id,e.location_id]);await i.execute("UPDATE ims_sales_orders SET status = ? WHERE id = ?",[a,t]),await i.commit()}catch(t){throw await i.rollback(),t}finally{i.release()}},async delete(t){await (0,o.MN)("DELETE FROM ims_sales_orders WHERE id = ?",[t])}},p={async getStats(){let[t]=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_products WHERE is_active = 1"),[a]=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_product_variants WHERE is_active = 1"),[e]=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_locations WHERE is_active = 1"),[i]=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_purchase_orders WHERE status IN ('draft','approved')"),[n]=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_sales_orders WHERE status IN ('draft','confirmed')"),[_]=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_stock WHERE qty_on_hand <= min_qty AND min_qty > 0"),r=await (0,o.UI)(`SELECT po.*, c.name AS supplier_name, l.name AS location_name
       FROM ims_purchase_orders po
       LEFT JOIN ims_contacts c ON c.id = po.supplier_id
       JOIN ims_locations l ON l.id = po.location_id
       ORDER BY po.created_at DESC LIMIT 5`),s=await (0,o.UI)(`SELECT so.*, c.name AS customer_name, l.name AS location_name
       FROM ims_sales_orders so
       LEFT JOIN ims_contacts c ON c.id = so.customer_id
       JOIN ims_locations l ON l.id = so.location_id
       ORDER BY so.created_at DESC LIMIT 5`);return{products:t?.cnt??0,variants:a?.cnt??0,locations:e?.cnt??0,openPOs:i?.cnt??0,openSOs:n?.cnt??0,lowStock:_?.cnt??0,recentPOs:r,recentSOs:s}}},S={list:async()=>(0,o.UI)(`SELECT st.*,
              l.name AS location_name,
              COUNT(i.id) AS item_count,
              SUM(i.counted_qty IS NOT NULL AND i.counted_qty <> i.expected_qty) AS variance_count
       FROM ims_stocktakes st
       JOIN ims_locations l ON l.id = st.location_id
       LEFT JOIN ims_stocktake_items i ON i.stocktake_id = st.id
       GROUP BY st.id
       ORDER BY st.created_at DESC`),async get(t){let a=await (0,o.UI)(`SELECT st.*, l.name AS location_name
       FROM ims_stocktakes st
       JOIN ims_locations l ON l.id = st.location_id
       WHERE st.id = ?`,[t]);if(!a[0])return null;let e=a[0];return e.items=await (0,o.UI)(`SELECT i.*,
              v.sku, v.barcode,
              p.name AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''),
                NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')
              ) AS variant_label
       FROM ims_stocktake_items i
       JOIN ims_product_variants v ON v.variant_id = i.variant_id
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE i.stocktake_id = ?
       ORDER BY p.name, v.sku`,[t]),e},async create(t){let a=["v.is_active = 1"],e=[];t.brand_id&&(a.push("p.brand_id = ?"),e.push(t.brand_id)),t.supplier_id&&(a.push("p.supplier_id = ?"),e.push(t.supplier_id)),t.product_type&&(a.push("p.product_type = ?"),e.push(t.product_type));let i=await (0,o.UI)(`SELECT v.variant_id,
              COALESCE(s.qty_on_hand, 0) AS qty_on_hand
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       LEFT JOIN ims_stock s ON s.variant_id = v.variant_id AND s.location_id = ?
       WHERE ${a.join(" AND ")}`,[t.location_id,...e]),n=(0,o.xE)(),_=await n.getConnection();try{await _.beginTransaction();let[a]=await _.execute(`INSERT INTO ims_stocktakes (reference, location_id, status, notes)
         VALUES (?, ?, 'draft', ?)`,[t.reference,t.location_id,t.notes??null]),e=a.insertId;if(i.length>0){let t=i.map(()=>"(?,?,?)").join(","),a=[];for(let t of i)a.push(e,t.variant_id,t.qty_on_hand);await _.execute(`INSERT INTO ims_stocktake_items (stocktake_id, variant_id, expected_qty) VALUES ${t}`,a)}return await _.commit(),e}catch(t){throw await _.rollback(),t}finally{_.release()}},async updateItem(t,a,e){await (0,o.MN)("UPDATE ims_stocktake_items SET counted_qty = ?, notes = ? WHERE id = ?",[a,e??null,t])},async changeStatus(t,a){let e=(await (0,o.UI)("SELECT status FROM ims_stocktakes WHERE id = ?",[t]))[0];if(!e)throw Error("Stocktake not found");if(!({draft:["in_progress","cancelled"],in_progress:["completed","cancelled"],completed:[],cancelled:[]})[e.status].includes(a))throw Error(`Cannot transition from ${e.status} to ${a}`);await (0,o.MN)("UPDATE ims_stocktakes SET status = ? WHERE id = ?",[a,t])},async applyToStock(t){let a=await S.get(t);if(!a)throw Error("Stocktake not found");if("completed"!==a.status)throw Error("Stocktake must be completed before applying");let e=(a.items??[]).filter(t=>null!==t.counted_qty),i=(0,o.xE)(),n=await i.getConnection();try{await n.beginTransaction();let i=0;for(let o of e){let e=Number(o.counted_qty),_=Number(o.expected_qty);await n.execute("INSERT IGNORE INTO ims_stock (variant_id, location_id) VALUES (?, ?)",[o.variant_id,a.location_id]),await n.execute("UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?",[e,o.variant_id,a.location_id]),e!==_&&(i++,await n.execute(`INSERT INTO ims_stock_movements
               (variant_id, location_id, movement_type, reference_type, reference_id, qty_change, qty_after_soh)
             VALUES (?, ?, 'stocktake', 'stocktake', ?, ?, ?)`,[o.variant_id,a.location_id,t,e-_,e]))}return await n.execute("UPDATE ims_stocktakes SET completed_at = NOW() WHERE id = ?",[t]),await n.commit(),{applied:e.length,variances:i}}catch(t){throw await n.rollback(),t}finally{n.release()}},async delete(t){let a=await (0,o.UI)("SELECT status FROM ims_stocktakes WHERE id = ?",[t]);if(a[0]?.status!=="draft")throw Error("Only draft stocktakes can be deleted");await (0,o.MN)("DELETE FROM ims_stocktake_items WHERE stocktake_id = ?",[t]),await (0,o.MN)("DELETE FROM ims_stocktakes WHERE id = ?",[t])},async previewVariants(t){let a=["v.is_active = 1"],e=[];t.brand_id&&(a.push("p.brand_id = ?"),e.push(t.brand_id)),t.supplier_id&&(a.push("p.supplier_id = ?"),e.push(t.supplier_id)),t.product_type&&(a.push("p.product_type = ?"),e.push(t.product_type));let i=await (0,o.UI)(`SELECT COUNT(*) AS cnt
       FROM ims_product_variants v
       JOIN ims_products p ON p.product_id = v.product_id
       WHERE ${a.join(" AND ")}`,e);return i[0]?.cnt??0}};async function N(){let t=new Date().getFullYear(),a=await (0,o.UI)("SELECT COUNT(*) AS cnt FROM ims_branch_transfers WHERE transfer_number LIKE ?",[`BT-${t}-%`]),e=String((a[0]?.cnt??0)+1).padStart(4,"0");return`BT-${t}-${e}`}let v={async list(t){let a=t?"WHERE bt.status = ?":"";return(0,o.UI)(`SELECT bt.*,
              fl.name AS from_location_name,
              tl.name AS to_location_name
         FROM ims_branch_transfers bt
         JOIN ims_locations fl ON fl.id = bt.from_location_id
         JOIN ims_locations tl ON tl.id = bt.to_location_id
         ${a}
         ORDER BY bt.transfer_date DESC, bt.id DESC`,t?[t]:[])},async get(t){let a=await (0,o.UI)(`SELECT bt.*,
              fl.name AS from_location_name,
              tl.name AS to_location_name
         FROM ims_branch_transfers bt
         JOIN ims_locations fl ON fl.id = bt.from_location_id
         JOIN ims_locations tl ON tl.id = bt.to_location_id
         WHERE bt.id = ?`,[t]);if(!a.length)return null;let e=await (0,o.UI)(`SELECT bti.*,
              v.sku,
              p.name AS product_name,
              CONCAT_WS(' / ',
                NULLIF(v.option1_value,''), NULLIF(v.option2_value,''),
                NULLIF(v.option3_value,'')) AS variant_label
         FROM ims_branch_transfer_items bti
         JOIN ims_variants v ON v.variant_id = bti.variant_id
         JOIN ims_products p ON p.product_id = v.product_id
         WHERE bti.transfer_id = ?`,[t]);return{...a[0],items:e}},async create(t,a){let e=t.transfer_number||await N(),i=0;for(let t of a)i+=Number(t.qty_sent)*Number(t.unit_cost);let n=(await (0,o.MN)(`INSERT INTO ims_branch_transfers
         (transfer_number, from_location_id, to_location_id, status, transfer_date, notes, total_value)
       VALUES (?, ?, ?, 'draft', ?, ?, ?)`,[e,t.from_location_id,t.to_location_id,t.transfer_date,t.notes??null,i])).insertId;for(let t of a){let a=Number(t.qty_sent)*Number(t.unit_cost);await (0,o.MN)(`INSERT INTO ims_branch_transfer_items
           (transfer_id, variant_id, qty_sent, unit_cost, line_value, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,[n,t.variant_id,t.qty_sent,t.unit_cost,a,t.notes??null])}return n},async update(t,a,e){let i=[],n=[];for(let t of["from_location_id","to_location_id","transfer_date","notes"])void 0!==a[t]&&(i.push(`${t} = ?`),n.push(a[t]));let _=(0,o.xE)(),r=await _.getConnection();try{if(await r.beginTransaction(),i.length&&(n.push(t),await r.execute(`UPDATE ims_branch_transfers SET ${i.join(", ")} WHERE id = ?`,n)),e){await r.execute("DELETE FROM ims_branch_transfer_items WHERE transfer_id = ?",[t]);let a=0;for(let i of e){let e=Number(i.qty_sent)*Number(i.unit_cost);a+=e,await r.execute(`INSERT INTO ims_branch_transfer_items
               (transfer_id, variant_id, qty_sent, unit_cost, line_value, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,[t,i.variant_id,i.qty_sent,i.unit_cost,e,i.notes??null])}await r.execute("UPDATE ims_branch_transfers SET total_value = ? WHERE id = ?",[a,t])}await r.commit()}catch(t){throw await r.rollback(),t}finally{r.release()}},async changeStatus(t,a,e){let i=(0,o.xE)(),n=await i.getConnection();try{await n.beginTransaction();let[[i]]=await n.execute("SELECT * FROM ims_branch_transfers WHERE id = ?",[t]);if(!i)throw Error("Branch transfer not found");let _=await (0,o.UI)("SELECT * FROM ims_branch_transfer_items WHERE transfer_id = ?",[t]),r=i.status;if(r===a){await n.commit();return}if(!({draft:["sent","cancelled"],sent:["received","cancelled"]})[r]?.includes(a))throw Error(`Cannot transition from ${r} to ${a}`);if("sent"===r&&"received"===a){for(let a of _){let o=e?.find(t=>t.item_id===a.id),_=null!=o?Number(o.qty_received):Number(a.qty_sent);if(await n.execute("UPDATE ims_branch_transfer_items SET qty_received = ? WHERE id = ?",[_,a.id]),_<=0)continue;await n.execute("INSERT IGNORE INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, 0)",[a.variant_id,i.from_location_id]);let[[r]]=await n.execute("SELECT qty_on_hand FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,i.from_location_id]),s=Number(r?.qty_on_hand??0)-_;await n.execute("UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id=? AND location_id=?",[s,a.variant_id,i.from_location_id]),await n.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'bt_out','branch_transfer',?,?,?,?)`,[a.variant_id,i.from_location_id,t,-_,s,a.unit_cost]),await n.execute("INSERT IGNORE INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, 0)",[a.variant_id,i.to_location_id]);let[[c]]=await n.execute("SELECT qty_on_hand, avg_cost FROM ims_stock WHERE variant_id=? AND location_id=?",[a.variant_id,i.to_location_id]),d=Number(c?.qty_on_hand??0),l=Number(c?.avg_cost??a.unit_cost),u=d<=0?Number(a.unit_cost):(l*d+Number(a.unit_cost)*_)/(d+_),E=d+_;await n.execute("UPDATE ims_stock SET qty_on_hand = ?, avg_cost = ? WHERE variant_id=? AND location_id=?",[E,u,a.variant_id,i.to_location_id]),await n.execute(`INSERT INTO ims_stock_movements
               (variant_id,location_id,movement_type,reference_type,reference_id,qty_change,qty_after_soh,unit_cost)
             VALUES (?,?,'bt_in','branch_transfer',?,?,?,?)`,[a.variant_id,i.to_location_id,t,_,E,u])}await n.execute("UPDATE ims_branch_transfers SET received_date = CURDATE() WHERE id = ?",[t])}await n.execute("UPDATE ims_branch_transfers SET status = ? WHERE id = ?",[a,t]),await n.commit()}catch(t){throw await n.rollback(),t}finally{n.release()}},async delete(t){await (0,o.MN)("DELETE FROM ims_branch_transfers WHERE id = ?",[t])}}},46724:(t,a,e)=>{"use strict";e.d(a,{MN:()=>d,UI:()=>c,xE:()=>s});var i=e(73785);let o=new Map,n=new Set(["ETIMEDOUT","ECONNRESET","ECONNREFUSED","EPIPE","PROTOCOL_CONNECTION_LOST"]);function _(t){return new Promise(a=>setTimeout(a,t))}function r(t){let a=String(t?.code??"");return n.has(a)}function s(t){let a=t??process.env.IMS_MYSQL_DATABASE??"";if(!a)throw Error("IMS database name not configured. Add IMS_MYSQL_DATABASE to .env.local and run scripts/setup-ims-database.mjs");return o.has(a)||o.set(a,i.createPool({host:process.env.IMS_MYSQL_HOST??process.env.MYSQL_HOST??"127.0.0.1",port:parseInt(process.env.MYSQL_PORT??"3306",10),database:a,user:process.env.MYSQL_USER??"",password:process.env.MYSQL_PASSWORD??"",waitForConnections:!0,connectionLimit:5,queueLimit:0,connectTimeout:parseInt(process.env.IMS_MYSQL_CONNECT_TIMEOUT_MS??"20000",10),enableKeepAlive:!0,keepAliveInitialDelay:0,timezone:"Z",charset:"utf8mb4"})),o.get(a)}async function c(t,a,e){let i=s(e);for(let e=0;e<2;e+=1)try{let[e]=await i.execute(t,a);return e}catch(t){if(!r(t)||1===e)throw t;await _(250)}return[]}async function d(t,a,e){let i=s(e);for(let e=0;e<2;e+=1)try{let[e]=await i.execute(t,a);return e}catch(t){if(!r(t)||1===e)throw t;await _(250)}throw Error("IMS execute failed")}}};