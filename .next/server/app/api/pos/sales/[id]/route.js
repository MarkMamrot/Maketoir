(()=>{var e={};e.id=5073,e.ids=[5073],e.modules={62849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=62849,e.exports=t},72934:e=>{"use strict";e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{"use strict";e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{"use strict";e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},78893:e=>{"use strict";e.exports=require("buffer")},84770:e=>{"use strict";e.exports=require("crypto")},17702:e=>{"use strict";e.exports=require("events")},98216:e=>{"use strict";e.exports=require("net")},35816:e=>{"use strict";e.exports=require("process")},76162:e=>{"use strict";e.exports=require("stream")},74026:e=>{"use strict";e.exports=require("string_decoder")},95346:e=>{"use strict";e.exports=require("timers")},82452:e=>{"use strict";e.exports=require("tls")},17360:e=>{"use strict";e.exports=require("url")},21764:e=>{"use strict";e.exports=require("util")},71568:e=>{"use strict";e.exports=require("zlib")},72254:e=>{"use strict";e.exports=require("node:buffer")},65714:e=>{"use strict";e.exports=require("node:diagnostics_channel")},6357:(e,t,a)=>{"use strict";a.r(t),a.d(t,{originalPathname:()=>h,patchFetch:()=>N,requestAsyncStorage:()=>m,routeModule:()=>E,serverHooks:()=>y,staticGenerationAsyncStorage:()=>S});var s={};a.r(s),a.d(s,{GET:()=>c,PUT:()=>p});var n=a(49303),i=a(88716),o=a(60670),r=a(87070),l=a(71615),_=a(16367),d=a(83376);function u(){let e=l.cookies().get("pos_session")?.value;if(!e)return null;try{return JSON.parse(e)}catch{return null}}async function c(e,{params:t}){if(!u())return r.NextResponse.json({error:"Unauthorised."},{status:401});let a=parseInt(t.id,10);if(isNaN(a))return r.NextResponse.json({error:"Invalid id."},{status:400});let s=await _.xI.get(a);return s?r.NextResponse.json(s):r.NextResponse.json({error:"Not found."},{status:404})}async function p(e,{params:t}){if(!u())return r.NextResponse.json({error:"Unauthorised."},{status:401});let a=parseInt(t.id,10);if(isNaN(a))return r.NextResponse.json({error:"Invalid id."},{status:400});try{let{status:t,parked_label:s}=await e.json();if(!["open","parked","completed","voided","layby_active","layby_complete"].includes(t))return r.NextResponse.json({error:`Invalid status: ${t}`},{status:400});if(await _.xI.updateStatus(a,t,{parked_label:s}),"voided"===t){let e=await _.xI.get(a);if(e&&e.items?.length>0){let t=e.items.map(e=>e.variant_id).filter(Boolean);t.length>0&&(0,d.x)(t).catch(e=>console.error("Failed inline cache refresh for POS sale void:",e))}}return r.NextResponse.json({success:!0})}catch(e){return console.error("POS sale update error:",e),r.NextResponse.json({error:e.message||String(e)},{status:500})}}let E=new n.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/pos/sales/[id]/route",pathname:"/api/pos/sales/[id]",filename:"route",bundlePath:"app/api/pos/sales/[id]/route"},resolvedPagePath:"/home/runner/work/Maketoir/Maketoir/src/app/api/pos/sales/[id]/route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:m,staticGenerationAsyncStorage:S,serverHooks:y}=E,h="/api/pos/sales/[id]/route";function N(){return(0,o.patchFetch)({serverHooks:y,staticGenerationAsyncStorage:S})}},16367:(e,t,a)=>{"use strict";a.d(t,{Tk:()=>p,nD:()=>d,pq:()=>c,xI:()=>u});var s=a(46724),n=a(98691);function i(e){return null==e?0:Number(e)}function o(e){return{...e,branch_ids:e.branch_ids?"string"==typeof e.branch_ids?JSON.parse(e.branch_ids):e.branch_ids:null}}function r(e){return{...e,subtotal:i(e.subtotal),discount_total:i(e.discount_total),tax_total:i(e.tax_total),total:i(e.total)}}function l(e){return{...e,qty:i(e.qty),unit_price:i(e.unit_price),original_price:null!=e.original_price?i(e.original_price):null,discount_value:i(e.discount_value),discount_amount:i(e.discount_amount),tax_rate:i(e.tax_rate),line_total:i(e.line_total)}}function _(e){return{...e,amount:i(e.amount)}}let d={list:async()=>(await (0,s.UI)("SELECT id, username, full_name, email, phone, branch_ids, is_active, created_at, updated_at FROM pos_users ORDER BY full_name")).map(o),async get(e){let t=await (0,s.UI)("SELECT * FROM pos_users WHERE id = ? LIMIT 1",[e]);return t[0]?o(t[0]):null},async findByUsername(e){let t=await (0,s.UI)("SELECT * FROM pos_users WHERE username = ? LIMIT 1",[e.trim().toLowerCase()]);return t[0]?o(t[0]):null},async create(e){let t=await n.ZP.hash(e.password,12);return(await (0,s.MN)(`INSERT INTO pos_users (username, password_hash, full_name, email, phone, branch_ids)
       VALUES (?, ?, ?, ?, ?, ?)`,[e.username.trim().toLowerCase(),t,e.full_name??null,e.email??null,e.phone??null,e.branch_ids?JSON.stringify(e.branch_ids):null])).insertId},async update(e,t){let a=[],i=[];if(void 0!==t.full_name&&(a.push("full_name = ?"),i.push(t.full_name)),void 0!==t.email&&(a.push("email = ?"),i.push(t.email)),void 0!==t.phone&&(a.push("phone = ?"),i.push(t.phone)),void 0!==t.is_active&&(a.push("is_active = ?"),i.push(t.is_active)),void 0!==t.branch_ids&&(a.push("branch_ids = ?"),i.push(t.branch_ids?JSON.stringify(t.branch_ids):null)),t.password){let e=await n.ZP.hash(t.password,12);a.push("password_hash = ?"),i.push(e)}0!==a.length&&(i.push(e),await (0,s.MN)(`UPDATE pos_users SET ${a.join(", ")} WHERE id = ?`,i))},verifyPassword:async(e,t)=>n.ZP.compare(t,e.password_hash)},u={async get(e){let t=await (0,s.UI)("SELECT * FROM pos_sales WHERE id = ? LIMIT 1",[e]);return t[0]?{sale:r(t[0]),items:(await (0,s.UI)("SELECT * FROM pos_sale_items WHERE sale_id = ?",[e])).map(l),payments:(await (0,s.UI)("SELECT * FROM pos_payments WHERE sale_id = ? ORDER BY created_at",[e])).map(_)}:null},async findByLocalId(e){let t=await (0,s.UI)("SELECT * FROM pos_sales WHERE local_id = ? LIMIT 1",[e]);return t[0]?r(t[0]):null},list:async(e,t)=>(await (0,s.UI)(`SELECT * FROM pos_sales
       WHERE location_id = ? AND DATE(created_at) = ?
       ORDER BY created_at DESC`,[e,t])).map(r),listParked:async e=>(await (0,s.UI)(`SELECT * FROM pos_sales WHERE location_id = ? AND status IN ('parked','layby_active')
       ORDER BY created_at DESC`,[e])).map(r),async complete(e){let t=(0,s.xE)(),a=await t.getConnection();try{await a.beginTransaction();let t=new Date().toISOString().replace("T"," ").replace("Z","").slice(0,19),s=["completed","layby_complete","voided"].includes(e.status)?t:null,[n]=await a.execute(`INSERT INTO pos_sales
           (local_id, location_id, cashier_id, sale_type, status,
            customer_name, customer_phone, subtotal, discount_total,
            tax_total, total, notes, parked_label, return_of_sale_id, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[e.local_id??null,e.location_id,e.cashier_id,e.sale_type,e.status,e.customer_name??null,e.customer_phone??null,e.subtotal,e.discount_total,e.tax_total,e.total,e.notes??null,e.parked_label??null,e.return_of_sale_id??null,s]),i=n.insertId;for(let t of e.items)await a.execute(`INSERT INTO pos_sale_items
             (sale_id, variant_id, code, name, qty, unit_price, original_price,
              discount_type, discount_value, discount_amount, tax_rate, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[i,t.variant_id??null,t.code??null,t.name,t.qty,t.unit_price,t.original_price??null,t.discount_type,t.discount_value,t.discount_amount,t.tax_rate,t.line_total]);for(let t of e.payments)await a.execute(`INSERT INTO pos_payments (sale_id, payment_method, amount, reference)
           VALUES (?, ?, ?, ?)`,[i,t.payment_method,t.amount,t.reference??null]);if("completed"===e.status||"layby_complete"===e.status)for(let t of e.items){if(!t.variant_id)continue;let s="return"===e.sale_type?t.qty:-t.qty;try{let[n]=await a.execute("SELECT qty_on_hand FROM ims_stock WHERE variant_id = ? AND location_id = ? LIMIT 1",[t.variant_id,e.location_id]),o=(n[0]?Number(n[0].qty_on_hand):0)+s;n[0]?await a.execute("UPDATE ims_stock SET qty_on_hand = ? WHERE variant_id = ? AND location_id = ?",[o,t.variant_id,e.location_id]):await a.execute("INSERT INTO ims_stock (variant_id, location_id, qty_on_hand) VALUES (?, ?, ?)",[t.variant_id,e.location_id,o]),await a.execute(`INSERT INTO ims_stock_movements
                 (variant_id, location_id, movement_type, reference_type, reference_id,
                  qty_change, qty_after_soh)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,[t.variant_id,e.location_id,"pos_sale","pos_sale",i,s,o])}catch{}}return await a.commit(),i}catch(e){throw await a.rollback(),e}finally{a.release()}},async updateStatus(e,t,a){let n=["completed","layby_complete","voided"].includes(t)?new Date().toISOString().replace("T"," ").replace("Z","").slice(0,19):null;a?.parked_label!==void 0?await (0,s.MN)("UPDATE pos_sales SET status = ?, parked_label = ?, completed_at = ? WHERE id = ?",[t,a.parked_label,n,e]):await (0,s.MN)("UPDATE pos_sales SET status = ?, completed_at = ? WHERE id = ?",[t,n,e])},async addPaymentToSale(e,t){await (0,s.MN)("INSERT INTO pos_payments (sale_id, payment_method, amount, reference) VALUES (?, ?, ?, ?)",[e,t.payment_method,t.amount,t.reference??null])}},c={get:async(e,t)=>(await (0,s.UI)("SELECT * FROM pos_eod_reconciliations WHERE location_id = ? AND recon_date = ? ORDER BY payment_method",[e,t])).map(e=>({...e,expected_amount:null!=e.expected_amount?i(e.expected_amount):null,counted_amount:null!=e.counted_amount?i(e.counted_amount):null,opening_float:null!=e.opening_float?i(e.opening_float):null,denomination_data:e.denomination_data?"string"==typeof e.denomination_data?JSON.parse(e.denomination_data):e.denomination_data:null})),async getExpected(e,t){let a=await (0,s.UI)(`SELECT p.payment_method, COALESCE(SUM(p.amount), 0) AS total
       FROM pos_payments p
       JOIN pos_sales s ON s.id = p.sale_id
       WHERE s.location_id = ? AND DATE(s.completed_at) = ?
         AND s.status IN ('completed','layby_complete')
       GROUP BY p.payment_method`,[e,t]),n={};for(let e of a)n[e.payment_method]=i(e.total);return n},async save(e){await (0,s.MN)(`INSERT INTO pos_eod_reconciliations
         (location_id, cashier_id, recon_date, payment_method,
          expected_amount, counted_amount, opening_float, denomination_data, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cashier_id        = VALUES(cashier_id),
         expected_amount   = VALUES(expected_amount),
         counted_amount    = VALUES(counted_amount),
         opening_float     = VALUES(opening_float),
         denomination_data = VALUES(denomination_data),
         notes             = VALUES(notes)`,[e.location_id,e.cashier_id,e.recon_date,e.payment_method,e.expected_amount??null,e.counted_amount??null,e.opening_float??null,e.denomination_data?JSON.stringify(e.denomination_data):null,e.notes??null])}},p={async dailyTransactions(e,t){let a=await (0,s.UI)(`SELECT s.*, u.full_name AS cashier_name
       FROM pos_sales s
       LEFT JOIN pos_users u ON u.id = s.cashier_id
       WHERE s.location_id = ? AND DATE(s.created_at) = ?
         AND s.status IN ('completed','layby_complete')
       ORDER BY s.created_at`,[e,t]);if(!a.length)return[];let n=a.map(e=>e.id),i=n.map(()=>"?").join(","),o=(await (0,s.UI)(`SELECT * FROM pos_sale_items WHERE sale_id IN (${i})`,n)).map(l),d=(await (0,s.UI)(`SELECT * FROM pos_payments WHERE sale_id IN (${i}) ORDER BY created_at`,n)).map(_);return a.map(e=>({sale:r(e),items:o.filter(t=>t.sale_id===e.id),payments:d.filter(t=>t.sale_id===e.id)}))},graphData:async(e,t)=>(await (0,s.UI)(`SELECT DATE(completed_at) AS date,
              COALESCE(SUM(total), 0) AS total,
              COUNT(*) AS count
       FROM pos_sales
       WHERE location_id = ?
         AND status IN ('completed','layby_complete')
         AND completed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(completed_at)
       ORDER BY date`,[e,t])).map(e=>({date:e.date instanceof Date?e.date.toISOString().slice(0,10):String(e.date),total:i(e.total),count:Number(e.count)}))}},83376:(e,t,a)=>{"use strict";a.d(t,{x:()=>n});var s=a(46724);async function n(e){let t=`
      SELECT
        variant_id,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 7   DAY) THEN qty ELSE 0 END) AS sales_qty_7d,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 90  DAY) THEN qty ELSE 0 END) AS sales_qty_90d,
        SUM(CASE WHEN sale_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY) THEN qty ELSE 0 END) AS sales_qty_180d,
        SUM(qty) AS sales_qty_12m
       FROM (
         -- IMS wholesale/B2B sales orders
         SELECT soi.variant_id, so.order_date AS sale_date, soi.qty_fulfilled AS qty
         FROM   ims_sales_order_items soi
         JOIN   ims_sales_orders      so  ON so.id = soi.so_id
         WHERE  so.status = 'fulfilled'
           AND  so.order_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)

         UNION ALL

         -- POS retail sales
         SELECT psi.variant_id, DATE(ps.completed_at) AS sale_date, psi.qty AS qty
         FROM   pos_sale_items psi
         JOIN   pos_sales      ps  ON ps.id = psi.sale_id
         WHERE  ps.status    = 'completed'
           AND  ps.sale_type = 'sale'
           AND  ps.completed_at >= DATE_SUB(NOW(), INTERVAL 365 DAY)
           AND  psi.variant_id IS NOT NULL
       ) all_sales
  `,a=`
      SELECT
        variant_id,
        SUM(qty_on_hand)                       AS global_soh,
        SUM(qty_on_hand - qty_committed)       AS global_available,
        SUM(qty_incoming)                      AS global_incoming
       FROM ims_stock
  `,n=[],i=[];if(e&&e.length>0){let s=e.map(()=>"?").join(",");t+=` WHERE variant_id IN (${s}) `,n.push(...e),a+=` WHERE variant_id IN (${s}) `,i.push(...e)}t+=" GROUP BY variant_id",a+=" GROUP BY variant_id";let o=await (0,s.UI)(t,n),r=await (0,s.UI)(a,i),l=new Map(o.map(e=>[e.variant_id,e])),_=new Map(r.map(e=>[e.variant_id,e])),d=new Set(e&&e.length>0?e:[...l.keys(),..._.keys()]);if(0===d.size)return 0;let u=[...d],c=(0,s.xE)();for(let e=0;e<u.length;e+=1e3){let t=u.slice(e,e+1e3),a=[],s=[];for(let e of t){let t=l.get(e),n=_.get(e);a.push(e,t?.sales_qty_7d??0,t?.sales_qty_90d??0,t?.sales_qty_180d??0,t?.sales_qty_12m??0,n?.global_soh??0,n?.global_available??0,n?.global_incoming??0),s.push("(?, ?, ?, ?, ?, ?, ?, ?)")}await c.query(`INSERT INTO ims_sales_cache
          (variant_id, sales_qty_7d, sales_qty_90d, sales_qty_180d, sales_qty_12m,
          global_soh, global_available, global_incoming)
        VALUES ${s.join(", ")}
        ON DUPLICATE KEY UPDATE
          sales_qty_7d     = VALUES(sales_qty_7d),
          sales_qty_90d    = VALUES(sales_qty_90d),
          sales_qty_180d   = VALUES(sales_qty_180d),
          sales_qty_12m    = VALUES(sales_qty_12m),
          global_soh       = VALUES(global_soh),
          global_available = VALUES(global_available),
          global_incoming  = VALUES(global_incoming),
          updated_at       = NOW()`,a)}return d.size}},46724:(e,t,a)=>{"use strict";a.d(t,{MN:()=>d,UI:()=>_,xE:()=>l});var s=a(73785);let n=new Map,i=new Set(["ETIMEDOUT","ECONNRESET","ECONNREFUSED","EPIPE","PROTOCOL_CONNECTION_LOST"]);function o(e){return new Promise(t=>setTimeout(t,e))}function r(e){let t=String(e?.code??"");return i.has(t)}function l(e){let t=e??process.env.IMS_MYSQL_DATABASE??"";if(!t)throw Error("IMS database name not configured. Add IMS_MYSQL_DATABASE to .env.local and run scripts/setup-ims-database.mjs");return n.has(t)||n.set(t,s.createPool({host:process.env.IMS_MYSQL_HOST??process.env.MYSQL_HOST??"127.0.0.1",port:parseInt(process.env.MYSQL_PORT??"3306",10),database:t,user:process.env.MYSQL_USER??"",password:process.env.MYSQL_PASSWORD??"",waitForConnections:!0,connectionLimit:5,queueLimit:0,connectTimeout:parseInt(process.env.IMS_MYSQL_CONNECT_TIMEOUT_MS??"20000",10),enableKeepAlive:!0,keepAliveInitialDelay:0,timezone:"Z",charset:"utf8mb4"})),n.get(t)}async function _(e,t,a){let s=l(a);for(let a=0;a<2;a+=1)try{let[a]=await s.execute(e,t);return a}catch(e){if(!r(e)||1===a)throw e;await o(250)}return[]}async function d(e,t,a){let s=l(a);for(let a=0;a<2;a+=1)try{let[a]=await s.execute(e,t);return a}catch(e){if(!r(e)||1===a)throw e;await o(250)}throw Error("IMS execute failed")}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),s=t.X(0,[8948,1615,5972,3785,3400],()=>a(6357));module.exports=s})();