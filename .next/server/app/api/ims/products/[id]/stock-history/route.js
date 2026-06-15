(()=>{var e={};e.id=1881,e.ids=[1881],e.modules={62849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=62849,e.exports=t},72934:e=>{"use strict";e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{"use strict";e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{"use strict";e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},78893:e=>{"use strict";e.exports=require("buffer")},84770:e=>{"use strict";e.exports=require("crypto")},17702:e=>{"use strict";e.exports=require("events")},98216:e=>{"use strict";e.exports=require("net")},35816:e=>{"use strict";e.exports=require("process")},76162:e=>{"use strict";e.exports=require("stream")},74026:e=>{"use strict";e.exports=require("string_decoder")},95346:e=>{"use strict";e.exports=require("timers")},82452:e=>{"use strict";e.exports=require("tls")},17360:e=>{"use strict";e.exports=require("url")},21764:e=>{"use strict";e.exports=require("util")},71568:e=>{"use strict";e.exports=require("zlib")},72254:e=>{"use strict";e.exports=require("node:buffer")},65714:e=>{"use strict";e.exports=require("node:diagnostics_channel")},6004:(e,t,r)=>{"use strict";r.r(t),r.d(t,{originalPathname:()=>v,patchFetch:()=>f,requestAsyncStorage:()=>d,routeModule:()=>l,serverHooks:()=>m,staticGenerationAsyncStorage:()=>p});var s={};r.r(s),r.d(s,{GET:()=>u});var i=r(49303),o=r(88716),a=r(60670),n=r(87070),c=r(71615),_=r(46724);async function u(e,{params:t}){if(!function(){let e=(0,c.cookies)().get("marketoir_session");if(!e?.value)return null;try{return JSON.parse(e.value)}catch{return null}}())return n.NextResponse.json({error:"Not authenticated"},{status:401});try{let e=t.id,r=new Date;r.setFullYear(r.getFullYear()-1);let s=r.toISOString().slice(0,19).replace("T"," "),i=await (0,_.UI)(`SELECT variant_id, sku, option1_value, option2_value, option3_value
       FROM ims_product_variants
       WHERE product_id = ?
       ORDER BY id`,[e]);if(0===i.length)return n.NextResponse.json({success:!0,variants:[],stockByLocation:[],openingBalances:[],movements:[],summary:{total_in:0,total_out:0,net:0,pos:{in:0,out:0,net:0},online:{in:0,out:0,net:0}}});let o=i.map(e=>e.variant_id),a=o.map(()=>"?").join(","),c=await (0,_.UI)(`SELECT s.variant_id, s.location_id, l.name AS location_name,
              s.qty_on_hand, s.qty_incoming, s.qty_committed
       FROM ims_stock s
       JOIN ims_locations l ON l.id = s.location_id
       WHERE s.variant_id IN (${a})
       ORDER BY l.name`,o),u=await (0,_.UI)(`SELECT m.variant_id, m.location_id, l.name AS location_name,
              m.qty_after_soh, m.created_at
       FROM ims_stock_movements m
       JOIN ims_locations l ON l.id = m.location_id
       INNER JOIN (
         SELECT variant_id, location_id, MAX(id) AS max_id
         FROM ims_stock_movements
         WHERE variant_id IN (${a})
           AND created_at < ?
         GROUP BY variant_id, location_id
       ) latest ON m.id = latest.max_id`,[...o,s]),l=await (0,_.UI)(`SELECT
         m.id, m.variant_id, m.location_id, l.name AS location_name,
         m.movement_type, m.reference_type, m.reference_id,
         m.qty_change, m.qty_after_soh, m.unit_cost, m.notes, m.created_at,
         po.po_number,
         so.so_number,
         so.shopify_order_id,
         sup.name AS supplier_name,
         cust.name AS customer_name,
         ps.local_id AS pos_sale_local_id
       FROM ims_stock_movements m
       JOIN ims_locations l ON l.id = m.location_id
       LEFT JOIN ims_purchase_orders po
         ON po.id = m.reference_id AND m.reference_type = 'purchase_order'
       LEFT JOIN ims_contacts sup ON sup.id = po.supplier_id
       LEFT JOIN ims_sales_orders so
         ON so.id = m.reference_id AND m.reference_type = 'sales_order'
       LEFT JOIN ims_contacts cust ON cust.id = so.customer_id
       LEFT JOIN pos_sales ps
         ON ps.id = m.reference_id AND m.reference_type = 'pos_sale'
       WHERE m.variant_id IN (${a})
         AND m.created_at >= ?
       ORDER BY m.created_at DESC`,[...o,s]),d=new Map;for(let e of u){let t=`${e.variant_id}::${e.location_id}`;d.set(t,{...e,inferred:!1})}let p=new Map;for(let e of c){let t=`${e.variant_id}::${e.location_id}`;p.set(t,{variant_id:e.variant_id,location_id:e.location_id,location_name:e.location_name,qty_on_hand:Number(e.qty_on_hand??0)})}let m=new Map;for(let e of l){let t=`${e.variant_id}::${e.location_id}`;m.set(t,(m.get(t)??0)+Number(e.qty_change??0))}for(let[e,t]of p.entries()){if(d.has(e))continue;let r=m.get(e)??0;d.set(e,{variant_id:t.variant_id,location_id:t.location_id,location_name:t.location_name,qty_after_soh:t.qty_on_hand-r,created_at:s,inferred:!0})}let v=Array.from(d.values()),f=0,h=0,E=0,y=0,N=0,O=0;for(let e of l){let t=Number(e.qty_change),r="pos_sale"===e.reference_type||e.movement_type.startsWith("pos_"),s="sales_order"===e.reference_type&&!!e.shopify_order_id;t>0?f+=t:h+=Math.abs(t),r&&(t>0?E+=t:y+=Math.abs(t)),s&&(t>0?N+=t:O+=Math.abs(t))}let S=new Map(i.map(e=>[e.variant_id,[e.option1_value,e.option2_value,e.option3_value].filter(Boolean).join(" / ")||e.sku||e.variant_id]));return n.NextResponse.json({success:!0,variants:i.map(e=>({...e,label:S.get(e.variant_id)})),stockByLocation:c,openingBalances:v,movements:l.map(e=>({...e,variant_label:S.get(e.variant_id),is_online_order:"sales_order"===e.reference_type&&!!e.shopify_order_id,is_pos_sale:"pos_sale"===e.reference_type||e.movement_type.startsWith("pos_")})),summary:{total_in:f,total_out:h,net:f-h,pos:{in:E,out:y,net:E-y},online:{in:N,out:O,net:N-O}}})}catch(e){return n.NextResponse.json({success:!1,error:e.message},{status:500})}}let l=new i.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/ims/products/[id]/stock-history/route",pathname:"/api/ims/products/[id]/stock-history",filename:"route",bundlePath:"app/api/ims/products/[id]/stock-history/route"},resolvedPagePath:"/home/runner/work/Maketoir/Maketoir/src/app/api/ims/products/[id]/stock-history/route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:d,staticGenerationAsyncStorage:p,serverHooks:m}=l,v="/api/ims/products/[id]/stock-history/route";function f(){return(0,a.patchFetch)({serverHooks:m,staticGenerationAsyncStorage:p})}},46724:(e,t,r)=>{"use strict";r.d(t,{MN:()=>u,UI:()=>_,xE:()=>c});var s=r(73785);let i=new Map,o=new Set(["ETIMEDOUT","ECONNRESET","ECONNREFUSED","EPIPE","PROTOCOL_CONNECTION_LOST"]);function a(e){return new Promise(t=>setTimeout(t,e))}function n(e){let t=String(e?.code??"");return o.has(t)}function c(e){let t=e??process.env.IMS_MYSQL_DATABASE??"";if(!t)throw Error("IMS database name not configured. Add IMS_MYSQL_DATABASE to .env.local and run scripts/setup-ims-database.mjs");return i.has(t)||i.set(t,s.createPool({host:process.env.IMS_MYSQL_HOST??process.env.MYSQL_HOST??"127.0.0.1",port:parseInt(process.env.MYSQL_PORT??"3306",10),database:t,user:process.env.MYSQL_USER??"",password:process.env.MYSQL_PASSWORD??"",waitForConnections:!0,connectionLimit:5,queueLimit:0,connectTimeout:parseInt(process.env.IMS_MYSQL_CONNECT_TIMEOUT_MS??"20000",10),enableKeepAlive:!0,keepAliveInitialDelay:0,timezone:"Z",charset:"utf8mb4"})),i.get(t)}async function _(e,t,r){let s=c(r);for(let r=0;r<2;r+=1)try{let[r]=await s.execute(e,t);return r}catch(e){if(!n(e)||1===r)throw e;await a(250)}return[]}async function u(e,t,r){let s=c(r);for(let r=0;r<2;r+=1)try{let[r]=await s.execute(e,t);return r}catch(e){if(!n(e)||1===r)throw e;await a(250)}throw Error("IMS execute failed")}}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[8948,1615,5972,3785],()=>r(6004));module.exports=s})();