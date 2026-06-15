(()=>{var e={};e.id=7401,e.ids=[7401],e.modules={62849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=62849,e.exports=t},72934:e=>{"use strict";e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{"use strict";e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{"use strict";e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},78893:e=>{"use strict";e.exports=require("buffer")},84770:e=>{"use strict";e.exports=require("crypto")},17702:e=>{"use strict";e.exports=require("events")},98216:e=>{"use strict";e.exports=require("net")},35816:e=>{"use strict";e.exports=require("process")},76162:e=>{"use strict";e.exports=require("stream")},74026:e=>{"use strict";e.exports=require("string_decoder")},95346:e=>{"use strict";e.exports=require("timers")},82452:e=>{"use strict";e.exports=require("tls")},17360:e=>{"use strict";e.exports=require("url")},21764:e=>{"use strict";e.exports=require("util")},71568:e=>{"use strict";e.exports=require("zlib")},72254:e=>{"use strict";e.exports=require("node:buffer")},65714:e=>{"use strict";e.exports=require("node:diagnostics_channel")},79877:(e,t,r)=>{"use strict";r.r(t),r.d(t,{originalPathname:()=>_,patchFetch:()=>N,requestAsyncStorage:()=>l,routeModule:()=>d,serverHooks:()=>m,staticGenerationAsyncStorage:()=>E});var s={};r.r(s),r.d(s,{GET:()=>p});var i=r(49303),a=r(88716),o=r(60670),n=r(87070),u=r(71615),c=r(46724);async function p(e){if(!function(){let e=(0,u.cookies)().get("marketoir_session");if(!e?.value)return null;try{return JSON.parse(e.value)}catch{return null}}())return n.NextResponse.json({error:"Not authenticated"},{status:401});let{searchParams:t}=new URL(e.url),r=(t.get("q")??"").trim(),s=Math.min(50,Math.max(1,parseInt(t.get("limit")??"25",10)));if(r.length<1)return n.NextResponse.json({suggestions:[]});let i=`%${r}%`,a=`${r}%`;try{let e=(await (0,c.UI)(`
      SELECT
        v.variant_id,
        v.sku,
        v.barcode,
        p.name AS product_name,
        p.brand,
        p.product_type,
        TRIM(BOTH ' / ' FROM CONCAT_WS(' / ',
          NULLIF(TRIM(COALESCE(v.option1_value,'')), ''),
          NULLIF(TRIM(COALESCE(v.option2_value,'')), ''),
          NULLIF(TRIM(COALESCE(v.option3_value,'')), '')
        )) AS option_label
      FROM ims_product_variants v
      JOIN ims_products p ON p.product_id = v.product_id
      WHERE v.is_active = 1
        AND p.is_active = 1
        AND (
          v.sku      LIKE ? OR
          v.barcode  LIKE ? OR
          p.name     LIKE ?
        )
      ORDER BY
        CASE
          WHEN v.sku = ? OR v.barcode = ?           THEN 0
          WHEN v.sku LIKE ? OR v.barcode LIKE ?     THEN 1
          WHEN p.name LIKE ?                         THEN 2
          ELSE 3
        END,
        p.name,
        v.sku
      LIMIT ?
    `,[i,i,i,r,r,a,a,a,s])).map(e=>{let t=[e.product_name,e.option_label].filter(Boolean),r=`Product: ${t.join(" — ")}  \xb7  Brand: ${e.brand??"—"}`,s=[];return e.sku&&s.push(`SKU: ${e.sku}`),e.barcode&&s.push(`Barcode: ${e.barcode}`),e.product_type&&s.push(e.product_type),{type:"product",value:e.variant_id,label:r,meta:s.join("  \xb7  ")||void 0}}),t=(await (0,c.UI)(`
      SELECT DISTINCT brand
      FROM ims_products
      WHERE is_active = 1
        AND brand IS NOT NULL
        AND brand != ''
        AND brand LIKE ?
      ORDER BY CASE WHEN brand LIKE ? THEN 0 ELSE 1 END, brand
      LIMIT ?
    `,[i,a,Math.ceil(s/3)])).map(e=>({type:"brand",value:e.brand,label:`Brand: ${e.brand}`,meta:"Filter all products from this brand"})),o=(await (0,c.UI)(`
      SELECT DISTINCT c.id, c.name
      FROM ims_contacts c
      JOIN ims_products p ON p.supplier_contact_id = c.id AND p.is_active = 1
      WHERE c.is_active = 1
        AND c.name LIKE ?
      ORDER BY CASE WHEN c.name LIKE ? THEN 0 ELSE 1 END, c.name
      LIMIT ?
    `,[i,a,Math.ceil(s/3)])).map(e=>({type:"supplier",value:String(e.id),label:`Supplier: ${e.name}`,meta:"Filter all products from this supplier"})),u=(await (0,c.UI)(`
      SELECT DISTINCT product_type
      FROM ims_products
      WHERE is_active = 1
        AND product_type IS NOT NULL
        AND product_type != ''
        AND product_type LIKE ?
      ORDER BY CASE WHEN product_type LIKE ? THEN 0 ELSE 1 END, product_type
      LIMIT ?
    `,[i,a,Math.ceil(s/3)])).map(e=>({type:"product_type",value:e.product_type,label:`Product Type: ${e.product_type}`,meta:"Filter all products of this type"})),p=[...o,...t,...u,...e].slice(0,s);return n.NextResponse.json({suggestions:p})}catch(e){return n.NextResponse.json({error:e.message},{status:500})}}let d=new i.AppRouteRouteModule({definition:{kind:a.x.APP_ROUTE,page:"/api/ims/filters/search/route",pathname:"/api/ims/filters/search",filename:"route",bundlePath:"app/api/ims/filters/search/route"},resolvedPagePath:"/home/runner/work/Maketoir/Maketoir/src/app/api/ims/filters/search/route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:l,staticGenerationAsyncStorage:E,serverHooks:m}=d,_="/api/ims/filters/search/route";function N(){return(0,o.patchFetch)({serverHooks:m,staticGenerationAsyncStorage:E})}},46724:(e,t,r)=>{"use strict";r.d(t,{MN:()=>p,UI:()=>c,xE:()=>u});var s=r(73785);let i=new Map,a=new Set(["ETIMEDOUT","ECONNRESET","ECONNREFUSED","EPIPE","PROTOCOL_CONNECTION_LOST"]);function o(e){return new Promise(t=>setTimeout(t,e))}function n(e){let t=String(e?.code??"");return a.has(t)}function u(e){let t=e??process.env.IMS_MYSQL_DATABASE??"";if(!t)throw Error("IMS database name not configured. Add IMS_MYSQL_DATABASE to .env.local and run scripts/setup-ims-database.mjs");return i.has(t)||i.set(t,s.createPool({host:process.env.IMS_MYSQL_HOST??process.env.MYSQL_HOST??"127.0.0.1",port:parseInt(process.env.MYSQL_PORT??"3306",10),database:t,user:process.env.MYSQL_USER??"",password:process.env.MYSQL_PASSWORD??"",waitForConnections:!0,connectionLimit:5,queueLimit:0,connectTimeout:parseInt(process.env.IMS_MYSQL_CONNECT_TIMEOUT_MS??"20000",10),enableKeepAlive:!0,keepAliveInitialDelay:0,timezone:"Z",charset:"utf8mb4"})),i.get(t)}async function c(e,t,r){let s=u(r);for(let r=0;r<2;r+=1)try{let[r]=await s.execute(e,t);return r}catch(e){if(!n(e)||1===r)throw e;await o(250)}return[]}async function p(e,t,r){let s=u(r);for(let r=0;r<2;r+=1)try{let[r]=await s.execute(e,t);return r}catch(e){if(!n(e)||1===r)throw e;await o(250)}throw Error("IMS execute failed")}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[8948,1615,5972,3785],()=>r(79877));module.exports=s})();