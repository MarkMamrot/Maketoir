(()=>{var e={};e.id=8873,e.ids=[8873],e.modules={62849:e=>{function s(e){var s=Error("Cannot find module '"+e+"'");throw s.code="MODULE_NOT_FOUND",s}s.keys=()=>[],s.resolve=s,s.id=62849,e.exports=s},72934:e=>{"use strict";e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{"use strict";e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{"use strict";e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},78893:e=>{"use strict";e.exports=require("buffer")},84770:e=>{"use strict";e.exports=require("crypto")},17702:e=>{"use strict";e.exports=require("events")},98216:e=>{"use strict";e.exports=require("net")},35816:e=>{"use strict";e.exports=require("process")},76162:e=>{"use strict";e.exports=require("stream")},74026:e=>{"use strict";e.exports=require("string_decoder")},95346:e=>{"use strict";e.exports=require("timers")},82452:e=>{"use strict";e.exports=require("tls")},17360:e=>{"use strict";e.exports=require("url")},21764:e=>{"use strict";e.exports=require("util")},71568:e=>{"use strict";e.exports=require("zlib")},72254:e=>{"use strict";e.exports=require("node:buffer")},65714:e=>{"use strict";e.exports=require("node:diagnostics_channel")},175:(e,s,t)=>{"use strict";t.r(s),t.d(s,{originalPathname:()=>m,patchFetch:()=>A,requestAsyncStorage:()=>p,routeModule:()=>d,serverHooks:()=>S,staticGenerationAsyncStorage:()=>E});var r={};t.r(r),t.d(r,{POST:()=>_});var a=t(49303),i=t(88716),o=t(60670),n=t(87070),l=t(71615),u=t(82253),c=t(83376);async function _(e){try{let{email:s,password:t}=await e.json();if(!s||!t)return n.NextResponse.json({success:!1,error:"Email and password are required."},{status:400});let r=await u.m.findByEmail(s),a=!!r&&await u.m.verifyPassword(r,t);if(!r||!a)return n.NextResponse.json({success:!1,error:"Invalid email or password."},{status:401});let i={name:r.name??"",company:r.company??"",email:r.email,userSpreadsheetId:r.business_id??"",role:r.role??"user",userId:r.id};return(0,l.cookies)().set("marketoir_session",JSON.stringify(i),{httpOnly:!0,secure:!0,sameSite:"strict",maxAge:28800,path:"/"}),(0,c.x)().catch(e=>console.error("Failed background cache refresh on login:",e)),n.NextResponse.json({success:!0,message:"Login successful.",user:i})}catch(e){return console.error("Login error:",e),n.NextResponse.json({success:!1,error:"Login failed. Please try again."},{status:500})}}let d=new a.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/auth/login/route",pathname:"/api/auth/login",filename:"route",bundlePath:"app/api/auth/login/route"},resolvedPagePath:"/home/runner/work/Maketoir/Maketoir/src/app/api/auth/login/route.ts",nextConfigOutput:"standalone",userland:r}),{requestAsyncStorage:p,staticGenerationAsyncStorage:E,serverHooks:S}=d,m="/api/auth/login/route";function A(){return(0,o.patchFetch)({serverHooks:S,staticGenerationAsyncStorage:E})}},82253:(e,s,t)=>{"use strict";t.d(s,{m:()=>i});var r=t(65037),a=t(98691);let i={findByEmail:async e=>(await (0,r.IO)("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1",[e.toLowerCase()]))[0]??null,findById:async e=>(await (0,r.IO)("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1",[e]))[0]??null,async create(e){let s=await a.ZP.hash(e.password,12);return(await (0,r.ht)(`INSERT INTO users (email, password_hash, name, company, phone, business_id, role, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,[e.email.toLowerCase(),s,e.name??null,e.company??null,e.phone??null,e.businessId??null,e.role??"admin"])).insertId},async updateBusinessId(e,s){await (0,r.ht)("UPDATE users SET business_id = ? WHERE id = ? AND deleted_at IS NULL",[s,e])},verifyPassword:async(e,s)=>a.ZP.compare(s,e.password_hash)}},83376:(e,s,t)=>{"use strict";t.d(s,{x:()=>a});var r=t(46724);async function a(e){let s=`
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
  `,t=`
      SELECT
        variant_id,
        SUM(qty_on_hand)                       AS global_soh,
        SUM(qty_on_hand - qty_committed)       AS global_available,
        SUM(qty_incoming)                      AS global_incoming
       FROM ims_stock
  `,a=[],i=[];if(e&&e.length>0){let r=e.map(()=>"?").join(",");s+=` WHERE variant_id IN (${r}) `,a.push(...e),t+=` WHERE variant_id IN (${r}) `,i.push(...e)}s+=" GROUP BY variant_id",t+=" GROUP BY variant_id";let o=await (0,r.UI)(s,a),n=await (0,r.UI)(t,i),l=new Map(o.map(e=>[e.variant_id,e])),u=new Map(n.map(e=>[e.variant_id,e])),c=new Set(e&&e.length>0?e:[...l.keys(),...u.keys()]);if(0===c.size)return 0;let _=[...c],d=(0,r.xE)();for(let e=0;e<_.length;e+=1e3){let s=_.slice(e,e+1e3),t=[],r=[];for(let e of s){let s=l.get(e),a=u.get(e);t.push(e,s?.sales_qty_7d??0,s?.sales_qty_90d??0,s?.sales_qty_180d??0,s?.sales_qty_12m??0,a?.global_soh??0,a?.global_available??0,a?.global_incoming??0),r.push("(?, ?, ?, ?, ?, ?, ?, ?)")}await d.query(`INSERT INTO ims_sales_cache
          (variant_id, sales_qty_7d, sales_qty_90d, sales_qty_180d, sales_qty_12m,
          global_soh, global_available, global_incoming)
        VALUES ${r.join(", ")}
        ON DUPLICATE KEY UPDATE
          sales_qty_7d     = VALUES(sales_qty_7d),
          sales_qty_90d    = VALUES(sales_qty_90d),
          sales_qty_180d   = VALUES(sales_qty_180d),
          sales_qty_12m    = VALUES(sales_qty_12m),
          global_soh       = VALUES(global_soh),
          global_available = VALUES(global_available),
          global_incoming  = VALUES(global_incoming),
          updated_at       = NOW()`,t)}return c.size}},46724:(e,s,t)=>{"use strict";t.d(s,{MN:()=>c,UI:()=>u,xE:()=>l});var r=t(73785);let a=new Map,i=new Set(["ETIMEDOUT","ECONNRESET","ECONNREFUSED","EPIPE","PROTOCOL_CONNECTION_LOST"]);function o(e){return new Promise(s=>setTimeout(s,e))}function n(e){let s=String(e?.code??"");return i.has(s)}function l(e){let s=e??process.env.IMS_MYSQL_DATABASE??"";if(!s)throw Error("IMS database name not configured. Add IMS_MYSQL_DATABASE to .env.local and run scripts/setup-ims-database.mjs");return a.has(s)||a.set(s,r.createPool({host:process.env.IMS_MYSQL_HOST??process.env.MYSQL_HOST??"127.0.0.1",port:parseInt(process.env.MYSQL_PORT??"3306",10),database:s,user:process.env.MYSQL_USER??"",password:process.env.MYSQL_PASSWORD??"",waitForConnections:!0,connectionLimit:5,queueLimit:0,connectTimeout:parseInt(process.env.IMS_MYSQL_CONNECT_TIMEOUT_MS??"20000",10),enableKeepAlive:!0,keepAliveInitialDelay:0,timezone:"Z",charset:"utf8mb4"})),a.get(s)}async function u(e,s,t){let r=l(t);for(let t=0;t<2;t+=1)try{let[t]=await r.execute(e,s);return t}catch(e){if(!n(e)||1===t)throw e;await o(250)}return[]}async function c(e,s,t){let r=l(t);for(let t=0;t<2;t+=1)try{let[t]=await r.execute(e,s);return t}catch(e){if(!n(e)||1===t)throw e;await o(250)}throw Error("IMS execute failed")}},65037:(e,s,t)=>{"use strict";t.d(s,{IO:()=>o,Mj:()=>i,ht:()=>n});var r=t(73785);let a=null;function i(){return a||(a=r.createPool({host:process.env.MYSQL_HOST??"localhost",port:parseInt(process.env.MYSQL_PORT??"3306",10),database:process.env.MYSQL_DATABASE??"",user:process.env.MYSQL_USER??"",password:process.env.MYSQL_PASSWORD??"",waitForConnections:!0,connectionLimit:5,queueLimit:0,timezone:"Z",charset:"utf8mb4"})),a}async function o(e,s){let[t]=await i().execute(e,s);return t}async function n(e,s){let[t]=await i().execute(e,s);return t}}};var s=require("../../../../webpack-runtime.js");s.C(e);var t=e=>s(s.s=e),r=s.X(0,[8948,1615,5972,3785,3400],()=>t(175));module.exports=r})();