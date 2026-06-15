"use strict";(()=>{var e={};e.id=1882,e.ids=[1882],e.modules={72934:e=>{e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},32615:e=>{e.exports=require("http")},32694:e=>{e.exports=require("http2")},35240:e=>{e.exports=require("https")},98216:e=>{e.exports=require("net")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},35816:e=>{e.exports=require("process")},68621:e=>{e.exports=require("punycode")},86624:e=>{e.exports=require("querystring")},76162:e=>{e.exports=require("stream")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},71568:e=>{e.exports=require("zlib")},15673:e=>{e.exports=require("node:events")},97742:e=>{e.exports=require("node:process")},47261:e=>{e.exports=require("node:util")},77032:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>x,patchFetch:()=>y,requestAsyncStorage:()=>m,routeModule:()=>g,serverHooks:()=>f,staticGenerationAsyncStorage:()=>h});var i={};r.r(i),r.d(i,{POST:()=>d});var s=r(49303),n=r(88716),o=r(60670),a=r(87070),l=r(71615),c=r(33203);async function u(e){let t=new c.GoogleSheetsService;try{let r=await t.getData(e,"BrandProfile!A:U");if(!r||r.length<2)return"";let i=r[1];return[[1,"Brand Mission"],[2,"Unique Value Proposition"],[3,"Brand Tone & Voice"],[4,"Target Demographics"],[5,"Hero Products"],[7,"Price Positioning"]].filter(([e])=>i[e]?.trim()).map(([e,t])=>`${t}: ${i[e].trim()}`).join("\n")}catch{return""}}async function p(e){let t=new c.GoogleSheetsService,r={description:null,title:null,tags:null};try{let i=await t.getData(e,"Config!A:B"),s=i?.find(e=>"WebsiteSheetId"===e[0])?.[1];if(!s)return r;let n=await t.getData(s,"ProductDescTemplate");if(!n||n.length<2)return r;let o=n[0];if(o[0]?.trim()==="Timestamp"){let e=n[1]?.[1]?.trim();if(e)try{return{...r,description:JSON.parse(e)}}catch{}return r}let a={description:null,title:null,tags:null};for(let e of n.slice(1)){let t=e[0]?.trim(),r=e[1]?.trim();if(t&&["description","title","tags"].includes(t)&&r)try{a[t]=JSON.parse(r)}catch{a[t]=r}}return a}catch{return r}}async function d(e){try{let t,r;let i=(0,l.cookies)().get("marketoir_session");if(!i?.value)return a.NextResponse.json({error:"Not authenticated."},{status:401});let s=process.env.GEMINI_API_KEY??process.env.GOOGLE_AI_API_KEY;if(!s)return a.NextResponse.json({error:"GEMINI_API_KEY not configured."},{status:500});let{product:n,urls:o,databaseId:c}=await e.json();if(!n?.name||!Array.isArray(o)||0===o.length)return a.NextResponse.json({error:"product.name and urls[] are required."},{status:400});let d=o.filter(e=>"string"==typeof e&&e.trim()),g="",m={description:null,title:null,tags:null};c&&([g,m]=await Promise.all([u(c),p(c)]));let h=m.title?`Follow this title template exactly:
${JSON.stringify(m.title,null,2)}`:"Create a clear, descriptive title including brand name, product type, and key features.",f=function(e){let t=[],r=e?.headingTag,i=e?.headingColour,s=e?.bulletChar,n=e?.bulletColour;if(r||i){let e=r??"h3",s=i?` style="color:${i};"`:"";t.push(`- Section headings: always use <${e}${s}>Heading Text</${e}>`)}if(n||s){let e=s??"✓";n?(t.push(`- Bullet lists: <ul style="list-style:none;padding:0;margin:0 0 14px 0;"><li style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;"><span style="color:${n};font-weight:bold;flex-shrink:0;">${e}</span><span>Item text here</span></li></ul>`),t.push("- No CSS classes. Inline styles only.")):t.push(`- Every list item MUST start with "${e}" — e.g. <li>${e} Feature text here</li>`)}return t.length>0?`
HTML RULES (mandatory):
${t.join("\n")}`:""}(m.description),x=m.description?`Follow this description template exactly:${f}
${JSON.stringify(m.description,null,2)}`:`Write a compelling HTML product description with key features and benefits.${f}`,y=m.tags?`Follow this tags template:
${JSON.stringify(m.tags,null,2)}`:"Generate relevant SEO tags as a comma-separated list.",S=g?`
BRAND CONTEXT:
${g}`:"",T=n.retailPrice?`
- Retail Price: $${n.retailPrice}`:"",N=n.code?`
- SKU: ${n.code}`:"",w=d.map((e,t)=>`${t+1}. ${e}`).join("\n"),b=`You are an expert e-commerce product content writer and URL evaluator. Use Google Search to research the product and candidate pages, then perform both tasks below.

PRODUCT TO FIND:
- Name: ${n.name}
- Brand: ${n.brand}${N}${n.barcode?`
- Barcode: ${n.barcode}`:""}${T}

CANDIDATE URLs (search for and visit each one):
${w}

═══════════════════════════════════════════════════════
TASK 1 — URL EVALUATION
═══════════════════════════════════════════════════════

Visit each candidate URL using Google Search. For each URL decide: is it the actual product listing page for THIS EXACT product by ${n.brand}?

Rules:
- keep = true  → confirmed product listing page for THIS specific product (any retailer is fine)
- keep = false → category page, search results page, brand homepage, wrong product, or unrelated page
- KEEP ONLY THE SINGLE BEST URL (the most authoritative/detailed product page). All others keep = false.
- If none are a product page, keep the most relevant one as keep = true.
- Do NOT invent URLs not in the list above.

═══════════════════════════════════════════════════════
TASK 2 — CONTENT GENERATION
═══════════════════════════════════════════════════════

Using the product information you find via Google Search on those pages, generate content for our e-commerce store.
${S}

STRICT CONTENT RULES — use ONLY product-specific information:
✅ Include: product features, materials, construction, fit, sizing, colours, technology, specifications, intended use
❌ Exclude: shipping costs, delivery times, return policies, store promotions, brand/store contact info, pricing from the third-party site, any other store-specific information

TITLE:
${h}

WEBSITE DESCRIPTION (HTML):
${x}

TAGS:
${y}

CIN7 DESCRIPTION:
Write a short plain-text internal stock description focusing on product type and key features only. Strictly under 220 characters. No HTML.

═══════════════════════════════════════════════════════
RETURN FORMAT
═══════════════════════════════════════════════════════

Return ONLY valid JSON — no markdown fences, no extra text:
{
  "rankedUrls": [
    { "url": "<exact url from the list above>", "keep": true, "reason": "<1 sentence>" }
  ],
  "title": "...",
  "cin7Description": "...",
  "websiteDescription": "...",
  "tags": "..."
}`,$=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${s}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:b}]}],systemInstruction:{parts:[{text:"You are an expert e-commerce content writer and URL evaluator. Always respond with valid JSON only — no markdown code blocks, no preamble."}]},tools:[{google_search:{}}],generationConfig:{temperature:.2,maxOutputTokens:4096}}),signal:AbortSignal.timeout(9e4)});if(!$.ok){let e=await $.text();return a.NextResponse.json({error:`Gemini error: ${$.status}`,detail:e.slice(0,300)},{status:502})}let q=await $.json(),v=q.candidates?.[0]?.content?.parts??[],O=([...v].reverse().find(e=>"string"==typeof e.text)?.text??"").trim(),R=O.replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/,"").trim();try{t=JSON.parse(R)}catch{let e=R.match(/\{[\s\S]*\}/);if(e)try{t=JSON.parse(e[0])}catch{}if(!t)return a.NextResponse.json({error:"AI returned unparseable JSON",raw:O.slice(0,500)},{status:500})}let E=(t.rankedUrls??[]).filter(e=>e?.url?.trim());return(t.title||t.cin7Description||t.websiteDescription)&&(r={title:String(t.title??"").trim(),cin7Description:String(t.cin7Description??"").trim().slice(0,220),websiteDescription:String(t.websiteDescription??"").trim(),tags:String(t.tags??"").trim(),images:Array(10).fill(""),cin7Online:"-4",cin7Channels:"Shopify https://monsterthreads.myshopify.com/"}),a.NextResponse.json({success:!0,rankedUrls:E,generatedContent:r})}catch(e){return console.error("[judge-urls]",e),a.NextResponse.json({error:e.message??"Internal server error"},{status:500})}}let g=new s.AppRouteRouteModule({definition:{kind:n.x.APP_ROUTE,page:"/api/website/judge-urls/route",pathname:"/api/website/judge-urls",filename:"route",bundlePath:"app/api/website/judge-urls/route"},resolvedPagePath:"/home/runner/work/Maketoir/Maketoir/src/app/api/website/judge-urls/route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:m,staticGenerationAsyncStorage:h,serverHooks:f}=g,x="/api/website/judge-urls/route";function y(){return(0,o.patchFetch)({serverHooks:f,staticGenerationAsyncStorage:h})}}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),i=t.X(0,[8948,1615,5972,1441,6684,5453,7816,3203],()=>r(77032));module.exports=i})();