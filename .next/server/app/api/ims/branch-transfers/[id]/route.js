"use strict";(()=>{var e={};e.id=7319,e.ids=[7319],e.modules={72934:e=>{e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},78893:e=>{e.exports=require("buffer")},84770:e=>{e.exports=require("crypto")},17702:e=>{e.exports=require("events")},98216:e=>{e.exports=require("net")},35816:e=>{e.exports=require("process")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},95346:e=>{e.exports=require("timers")},82452:e=>{e.exports=require("tls")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},71568:e=>{e.exports=require("zlib")},72254:e=>{e.exports=require("node:buffer")},65714:e=>{e.exports=require("node:diagnostics_channel")},33556:(e,t,s)=>{s.r(t),s.d(t,{originalPathname:()=>h,patchFetch:()=>S,requestAsyncStorage:()=>f,routeModule:()=>E,serverHooks:()=>g,staticGenerationAsyncStorage:()=>q});var r={};s.r(r),s.d(r,{DELETE:()=>m,GET:()=>c,PUT:()=>p});var a=s(49303),i=s(88716),n=s(60670),o=s(87070),l=s(71615),u=s(69033),d=s(83376);function _(){let e=(0,l.cookies)().get("marketoir_session");if(!e?.value)return null;try{return JSON.parse(e.value)}catch{return null}}async function c(e,{params:t}){if(!_())return o.NextResponse.json({error:"Not authenticated"},{status:401});try{let e=await u.qe.get(Number(t.id));if(!e)return o.NextResponse.json({success:!1,error:"Not found"},{status:404});return o.NextResponse.json({success:!0,data:e})}catch(e){return o.NextResponse.json({success:!1,error:e.message},{status:500})}}async function p(e,{params:t}){if(!_())return o.NextResponse.json({error:"Not authenticated"},{status:401});try{let{items:s,status:r,receivedItems:a,...i}=await e.json();if(r){await u.qe.changeStatus(Number(t.id),r,a);let e=await u.qe.get(Number(t.id));if(e&&e.items?.length>0){let t=e.items.map(e=>e.variant_id).filter(Boolean);t.length>0&&(0,d.x)(t).catch(e=>console.error("Failed inline cache refresh for BT:",e))}}else if(await u.qe.update(Number(t.id),i,s),s&&s.length>0){let e=s.map(e=>e.variant_id).filter(Boolean);e.length>0&&(0,d.x)(e).catch(e=>console.error("Failed inline cache refresh for BT:",e))}return o.NextResponse.json({success:!0})}catch(e){return o.NextResponse.json({success:!1,error:e.message},{status:500})}}async function m(e,{params:t}){if(!_())return o.NextResponse.json({error:"Not authenticated"},{status:401});try{let e=await u.qe.get(Number(t.id));if(await u.qe.delete(Number(t.id)),e&&e.items?.length>0){let t=e.items.map(e=>e.variant_id).filter(Boolean);t.length>0&&(0,d.x)(t).catch(e=>console.error("Failed inline cache refresh for BT deletion:",e))}return o.NextResponse.json({success:!0})}catch(e){return o.NextResponse.json({success:!1,error:e.message},{status:500})}}let E=new a.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/ims/branch-transfers/[id]/route",pathname:"/api/ims/branch-transfers/[id]",filename:"route",bundlePath:"app/api/ims/branch-transfers/[id]/route"},resolvedPagePath:"/home/runner/work/Maketoir/Maketoir/src/app/api/ims/branch-transfers/[id]/route.ts",nextConfigOutput:"standalone",userland:r}),{requestAsyncStorage:f,staticGenerationAsyncStorage:q,serverHooks:g}=E,h="/api/ims/branch-transfers/[id]/route";function S(){return(0,n.patchFetch)({serverHooks:g,staticGenerationAsyncStorage:q})}},6649:(e,t,s)=>{s.d(t,{Z:()=>o});var r=s(84770),a=s.n(r);let i=new Uint8Array(256),n=i.length;function o(){return n>i.length-16&&(a().randomFillSync(i),n=0),i.slice(n,n+=16)}},16099:(e,t,s)=>{s.d(t,{S:()=>i,Z:()=>n});var r=s(30900);let a=[];for(let e=0;e<256;++e)a.push((e+256).toString(16).slice(1));function i(e,t=0){return a[e[t+0]]+a[e[t+1]]+a[e[t+2]]+a[e[t+3]]+"-"+a[e[t+4]]+a[e[t+5]]+"-"+a[e[t+6]]+a[e[t+7]]+"-"+a[e[t+8]]+a[e[t+9]]+"-"+a[e[t+10]]+a[e[t+11]]+a[e[t+12]]+a[e[t+13]]+a[e[t+14]]+a[e[t+15]]}let n=function(e,t=0){let s=i(e,t);if(!(0,r.Z)(s))throw TypeError("Stringified UUID is invalid");return s}},56573:(e,t,s)=>{s.d(t,{Z:()=>o});var r=s(84770);let a={randomUUID:s.n(r)().randomUUID};var i=s(6649),n=s(16099);let o=function(e,t,s){if(a.randomUUID&&!t&&!e)return a.randomUUID();let r=(e=e||{}).random||(e.rng||i.Z)();if(r[6]=15&r[6]|64,r[8]=63&r[8]|128,t){s=s||0;for(let e=0;e<16;++e)t[s+e]=r[e];return t}return(0,n.S)(r)}},30900:(e,t,s)=>{s.d(t,{Z:()=>a});let r=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i,a=function(e){return"string"==typeof e&&r.test(e)}},83376:(e,t,s)=>{s.d(t,{x:()=>a});var r=s(46724);async function a(e){let t=`
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
  `,s=`
      SELECT
        variant_id,
        SUM(qty_on_hand)                       AS global_soh,
        SUM(qty_on_hand - qty_committed)       AS global_available,
        SUM(qty_incoming)                      AS global_incoming
       FROM ims_stock
  `,a=[],i=[];if(e&&e.length>0){let r=e.map(()=>"?").join(",");t+=` WHERE variant_id IN (${r}) `,a.push(...e),s+=` WHERE variant_id IN (${r}) `,i.push(...e)}t+=" GROUP BY variant_id",s+=" GROUP BY variant_id";let n=await (0,r.UI)(t,a),o=await (0,r.UI)(s,i),l=new Map(n.map(e=>[e.variant_id,e])),u=new Map(o.map(e=>[e.variant_id,e])),d=new Set(e&&e.length>0?e:[...l.keys(),...u.keys()]);if(0===d.size)return 0;let _=[...d],c=(0,r.xE)();for(let e=0;e<_.length;e+=1e3){let t=_.slice(e,e+1e3),s=[],r=[];for(let e of t){let t=l.get(e),a=u.get(e);s.push(e,t?.sales_qty_7d??0,t?.sales_qty_90d??0,t?.sales_qty_180d??0,t?.sales_qty_12m??0,a?.global_soh??0,a?.global_available??0,a?.global_incoming??0),r.push("(?, ?, ?, ?, ?, ?, ?, ?)")}await c.query(`INSERT INTO ims_sales_cache
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
          updated_at       = NOW()`,s)}return d.size}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var s=e=>t(t.s=e),r=t.X(0,[8948,1615,5972,3785,8357],()=>s(33556));module.exports=r})();